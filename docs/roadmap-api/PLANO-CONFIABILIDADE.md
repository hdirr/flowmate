# Plano de confiabilidade e multi-linha (CF-A … CF-D)

> Pedido do Agadir em 2026-10-13.
> **Objetivo:** nível de CRMs como a Helena.
> - Nenhuma empresa perde conversa.
> - Nenhuma linha trava outra (empresa com 1 ou 5 linhas).
> - Se algo falhar, o sistema detecta, recupera sozinho e avisa.
>
> **Regras de engenharia:**
> - Migração sem perda: esquema aditivo → backfill → troca de leitura.
> - Cada etapa entra sozinha em produção, atrás de chave quando mexe no caminho de mensagens, com
>   desligamento imediato.
> - `/v1` retrocompatível.
> - Idempotência em tudo que pode repetir.
>
> As fases daqui se chamam **CF-A, CF-B, CF-C, CF-D** (não confundir com as fases A/B,
> "expandir → contrair", de cada bloco da Parte 2).
> "**A confirmar**" = não verifiquei no código ou na documentação da versão em uso.

---

## a) Caminho real de uma mensagem hoje

### Recebida (cliente → empresa)
```
WhatsApp → Evolution (Railway, instância flowmate-{company_id}, Baileys)
  → grava no Postgres da Evolution (DATABASE_SAVE_DATA_NEW_MESSAGE)
  → POST webhook da instância → Vercel /api/whatsapp/webhook  (api/whatsapp/[...path].js, handleWebhook)
       1. confere WEBHOOK_SECRET (se a variável existir; hoje não existe)
       2. company_id = nome da instância sem "flowmate-"
       3. para cada mensagem do lote:
          a. dedup: SELECT whatsapp_messages por message_id (SEM filtro de empresa)
          b. getOrCreateConversation (E0b: null se a leitura falhar)
          c. fromMe com message_id desconhecido → "respondeu pelo celular" → conversa human
          d. INSERT whatsapp_messages (erro só vai para o log)
          e. message.received para o n8n (só 1:1, não fromMe, conversa em automation)
             → dispatchWebhook (api/_lib/webhooks.js): POST assinado, 1 tentativa, sem fila,
               SEM tempo limite e aguardado antes do 200 (um n8n lento segura o webhook;
               só o conversation.state_changed tem limite de 3 s)
       4. responde 200
  → Tela de Chats: polling a cada 3 s por id (Realtime desligado por causa do proxy .co)
```

| Falha | O que acontece hoje | Perde? |
| --- | --- | --- |
| **INSERT da mensagem falha** (coluna inexistente, Supabase fora, timeout) | só log `[webhook] insert falhou`; **responde 200** | **Sim, a linha da mensagem.** A Evolution não reenvia (2xx). Volta só no "Importar conversas" (Evolution guarda; janela de 7 dias). A pausa pelo celular é gravada (vem antes do INSERT) e o `message.received` **sai mesmo assim**: o n8n pode responder a uma mensagem que não está no banco. Já aconteceu em 26/09 (coluna `file_name`) |
| Exceção no handler (ex.: `getOrCreateConversation` antes da E0b) | 500 | Não, se a Evolution reenviar (abaixo) |
| Leitura do Supabase falha (dedup, conversa) | o cliente Supabase devolve `{error}` sem lançar. O dedup "não acha" e segue; a conversa vira `null` (E0b) | Parcial: a mensagem grava sem conversa; não sai `message.received` |
| **Vercel estoura o tempo** | a Evolution recebe timeout/5xx e **reenvia** | A mensagem não se perde, se o processo da Evolution não reiniciar no meio (o dedup evita duplicar). **Mas** se o tempo estourar depois do INSERT, a nova tentativa vê "já gravada" e **pula o `message.received` e a checagem da pausa**: o evento se perde |
| **Evolution cai** | mensagens chegam ao celular; ao reconectar, o Baileys recebe as pendentes (a confirmar: em que volume e em quanto tempo) | Possível em quedas longas ou na troca de sessão (incidente de 09/2026: histórico só volta com novo QR) |
| **Webhook do n8n fora** | `dispatchWebhook` tenta 1 vez | **Sim, o evento se perde** (bloco 3 da Parte 2) |
| **Duas empresas veem a mesma mensagem** (uma empresa escreve para a outra, ou estão no mesmo grupo) | o dedup do webhook (e o `isKnownOutgoing`) não filtra por empresa: a mensagem da 2ª empresa é tratada como "já gravada" e **descartada**. Pior: se a empresa B responde à A pelo celular e a A gravou primeiro, o webhook da B **pula a pausa** e a automação da B atropela. O sync faz `upsert(onConflict: message_id, ignoreDuplicates)`: também descarta (perda, não vazamento). **A confirmar:** o repo só tem índice **não único e parcial** em `message_id`. Se o banco não tiver um índice único em `message_id`, o `ON CONFLICT` falha e, como o erro não é checado, o sync **não importa nada, em silêncio** | **Sim, perda e interferência entre empresas.** Latente hoje (só 1 empresa com WhatsApp) |

**Política de reenvio da Evolution v2.3.7** (código `webhook.controller.ts` e `.env.example` da tag
`2.3.7`):
- vale também para o webhook **por instância**, que é o que o FlowMate usa;
- até `WEBHOOK_RETRY_MAX_ATTEMPTS = 10` tentativas, com espera exponencial de 5 s até 300 s
  (≈ 20 min no total) e ±20 % de variação;
- tempo limite por requisição `WEBHOOK_REQUEST_TIMEOUT_MS`: padrão 30 s no código, 60 s no
  exemplo;
- **não reenvia** em 400, 401, 403, 404 e 422; reenvia em 5xx, timeout e erro de rede;
- **reenvio só em memória:** se a Evolution reiniciar durante as tentativas, o evento some;
- envia em sequência (a instância espera as tentativas antes do próximo envio do mesmo
  `emit`);
- a confirmar: os valores que estão no Railway.

**Consequência:** a regra que importa é **"só responder 2xx depois de gravar"**. Hoje o webhook
responde 200 mesmo sem gravar. Esse é o principal buraco (A1).

### Enviada (empresa → cliente)
```
n8n → POST /v1/messages | /v1/conversations/{id}/messages   (api/_lib/v1*)
tela → /api/whatsapp/send | send-media                       (api/whatsapp/[...path].js)
automação do navegador → /api/whatsapp/send (src/lib/store.js)
  → sendMessage (api/_lib/sendMessage.js)
       1. normaliza o número (api/_lib/phone.js), getOrCreateConversation
       2. 409 se human (conversa ou gêmea) — E0/E0b
       3. fetch Evolution /message/sendText|sendMedia  (SEM tempo limite próprio)
       4. INSERT whatsapp_messages (SEM checar erro) com o message_id devolvido
       5. human → conversa vira human; message.sent para o n8n
```

| Falha | Hoje |
| --- | --- |
| Evolution recusa (responde com erro) | 502 para quem chamou; **sem nova tentativa**. A automação do navegador ignora o erro (`.catch(() => {})`, nem lê o status) |
| Evolution inalcançável | o `fetch` lança e não há try/catch em `sendMessage` nem nas rotas: quem chamou recebe **500** |
| Evolution lenta | o `fetch` fica preso até o limite da função da Vercel (a confirmar: duração máxima configurada no projeto) |
| **INSERT falha depois de enviar** (ou a Evolution não devolve `key.id`, e o INSERT grava `message_id` nulo) | mensagem enviada e **não registrada**. Quando o eco `fromMe` chega pelo webhook, `isKnownOutgoing` não acha o `message_id` → **a conversa vira "humano" por engano** |
| **Corrida do eco** | a Evolution pode mandar o `messages.upsert` (`fromMe`) do próprio envio antes de o INSERT do passo 4 terminar → mesmo efeito: pausa falsa. A confirmar a frequência (o HANDOFF registra a detecção do celular como validada, sem esse caso) |
| Repetição pelo n8n | envia de novo (não há chave de idempotência no envio) |

### Outros achados do diagnóstico
- **Paginação do "Importar conversas" e da rolagem do histórico:** o `findMessages` da 2.3.7 usa
  `offset` como tamanho de página e **ignora `limit`**. O código manda `limit` (o sync pede 30), então:
  - o sync traz no máximo 50 mensagens por conversa (o padrão da Evolution), e só das 60
    conversas 1:1 e 30 grupos mais recentes;
  - o `/history` sempre pagina de 50 em 50.

  A confirmar em produção; correção pequena (trocar para `offset`), na A4.
- **Vercel:** nenhum cron hoje. No plano Hobby o cron é limitado (uma vez por dia; a confirmar o
  limite atual). Além disso, os termos do Hobby são para **uso não comercial**: cobrar clientes
  rodando no Hobby é uma pendência de A8.
- **Supabase:** a validade da `anon key` e o proxy `/sb-proxy` não mudam aqui. O plano gratuito
  pausa projeto parado e não tem backup diário com restauração (A8).

---

## b) Multi-linha hoje

| Onde | Como é |
| --- | --- |
| Instância | **uma por empresa**: `instanceNameFor(companyId) = flowmate-{company_id}` (`api/_lib/db.js`) |
| Tabela `whatsapp_instances` | `company_id`, `instance_name`, `status`, `phone`; todo `upsert` usa `onConflict: company_id` → **uma linha por empresa** (a confirmar a chave única no banco) |
| Webhook | descobre a empresa **pelo nome da instância** |
| `conversations` | única por `(company_id, remote_jid)` (índice `conversations_company_id_remote_jid_key`, confirmado pelo Agadir em 13/10): o mesmo cliente falando com 2 linhas da mesma empresa cairia **na mesma conversa** |
| `whatsapp_messages` | tem `instance_name` (gravado em todo insert), sem `line_id` |
| Envio | sempre pela instância da empresa |
| Planos | `line_cap` existe em `companies`; só a Faixa 1 (1 linha) está à venda |

**Evolution:**
- várias instâncias por servidor; cada instância é uma sessão Baileys (WebSocket + memória);
- o limite por servidor depende de RAM/CPU e do volume. A confirmar com teste de carga (C4).
  Referência de mercado, não verificada: dezenas de instâncias por servidor de 2–4 GB;
- o Postgres da Evolution guarda mensagens de todas as instâncias (é ele que encheu o volume em
  09/2026).

---

## c) Plano

### CF-A — não perder mais nada (antes do primeiro cliente pagante)

| # | Escopo (3 linhas) | Tam. | Depende | O que o Agadir faz | Custo/mês | Riscos |
| --- | --- | --- | --- | --- | --- | --- |
| **A0** Evolution segura | Roteiro (não código): fixar a imagem **pelo digest em uso** (a `latest` do Docker Hub mudou em 06/05/2026 e não é a `v2.3.7`); `DATABASE_SAVE_*` recomendadas; validação e reversão. Em `relatorios/PLANO-S3-W2.md`, janela 0 | P | — | Executa com o tutor | 0 | Redeploy da Evolution pode pedir QR |
| **A1** Caixa de entrada durável | Webhook grava cada mensagem/evento crus em `inbound_events` **antes** de processar; só responde 2xx depois de gravar (senão 503, a Evolution reenvia). Processa logo em seguida; falha marca para nova tentativa | M | SQL | Rodar o SQL; ligar a chave na empresa dele | 0 | Caminho de recebimento: atrás da chave `inbound_inbox`; desligada = hoje |
| **A2** Idempotência | Chave única `(company_id, message_id)` em `whatsapp_messages` (convive com a global, se existir, até a troca); upsert com essa chave em webhook, sync, envio e reconciliação; dedup do webhook filtrado por empresa | M | SQL + consultas de duplicata | Rodar as consultas antes; decidir as duplicatas | 0 | A chave global de hoje: trocar só depois de todo código usar a nova |
| **A3** Processador e agendador | Rota `/api/whatsapp/jobs` (no catch-all; nenhuma função nova) processa eventos com falha, com espera crescente, limite de tentativas e **fila de mortos** visível; também roda a A4. **Agendador: `pg_cron` + `pg_net` no Supabase**, chamando a rota a cada minuto com segredo | M | SQL (`pg_cron`, `pg_net`), variável `JOBS_SECRET` na Vercel | Criar `JOBS_SECRET`; habilitar as extensões (se o SQL não puder) | 0 (incluído no Supabase) | Supabase fora = agendador fora (o alerta da A5 vem de fora, abaixo) |
| **A4** Reconciliação por linha | A cada 5 min, por instância conectada: `findMessages` com `messageTimestamp` desde o marcador (com sobreposição de 10 min), paginando por `offset`; grava o que faltar (upsert da A2); avança o marcador. Corrige o `offset` do sync e do `/history` | M | A2, A3 | — | 0 | Carga na Evolution: lote pequeno e limite por execução |
| **A5** Saúde e alertas | Tabela de saúde por linha (conectada, última mensagem recebida, eventos com falha/mortos, recuperadas pela A4) e da infra (Evolution responde). Alertas por e-mail (linha desconectada > 5 min, gravação falhando, evento morto, Evolution fora, disco > 70 %). Tela de saúde para admin. **Vigia de fora:** UptimeRobot/BetterStack batendo em `/api/whatsapp/health` | M | A3; provedor de e-mail | Criar conta no provedor de e-mail e no monitor externo; me passar os nomes das variáveis | 0 (Resend até 3 mil e-mails/mês; UptimeRobot grátis) | **Disco da Evolution:** a Evolution não expõe. Via API do Railway (token) ou consulta ao Postgres da Evolution (a confirmar). Até lá, o alerta de disco fica manual |
| **A6** Envio confiável | `outbound_messages`: grava **antes** de enviar (pendente → enviada/falhou, tentativas). Chave de idempotência opcional na `/v1` (`Idempotency-Key`). Reenvio pela A3 só em erro antes de a Evolution aceitar (nunca duplica). O eco `fromMe` casa com o pendente → acaba a pausa falsa. Status na tela e na API | G | A1–A3 | — | 0 | Caminho de envio: chave `send_queue`; desligada = hoje |
| **A7** Segurança da entrada | P1-S3 (`WEBHOOK_SECRET` com modo transição) e P1-W2, conforme `PLANO-S3-W2.md`. O modo transição é código meu, atrás da variável | P | A0 | Executa as janelas com o tutor | 0 | Ver o plano S3/W2 |
| **A8** Contratações | Ver a tabela de custos abaixo | — | — | Decidir e contratar | ver tabela | — |

**Ordem de execução da CF-A:**
1. **SQL único** (`supabase_cf_a.sql`), uma parada só. Inclui o SQL do `PLANO-ETIQUETAS`.
2. A1 + A2 (código atrás da chave, já adiantado antes do SQL);
3. A3;
4. A4;
5. A5;
6. A6;
7. A0 e A7 quando o Agadir marcar com o tutor (independentes do código).

**A8 — o que contratar/mudar (estimativa; preços a confirmar no site de cada um):**
| Item | Por quê | Custo/mês |
| --- | --- | --- |
| Supabase **Pro** | backup diário com restauração, não pausa, mais banco e conexões | ~US$ 25 |
| Vercel **Pro** | os termos do Hobby são para uso não comercial; cron mais frequente, funções mais longas, logs por mais tempo | ~US$ 20 |
| Railway (já tem Hobby) | Evolution + Postgres + Redis; uso cresce com as linhas | ~US$ 5 + uso (hoje a confirmar no painel) |
| E-mail transacional (Resend ou similar) | alertas | 0 (gratuito até ~3 mil/mês) |
| Monitor externo (UptimeRobot/BetterStack) | avisa quando tudo cai, inclusive o agendador | 0 (gratuito) |
| **Total novo** | | **~US$ 45/mês** |

### CF-B — multi-linha
| # | Escopo | Tam. | Depende | Agadir | Custo | Riscos |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | `whatsapp_lines` (empresa, instância, número, status, servidor, principal). Backfill: a linha atual de cada empresa vira a principal, sem renomear a instância `flowmate-{company_id}` | M | CF-A | SQL | 0 | Nenhuma (aditivo) |
| B2 | `line_id` em `conversations` e `whatsapp_messages` (backfill = principal); conversa única por `(company_id, line_id, remote_jid)`; webhook descobre a linha pela instância; envio pela linha da conversa; `/v1` com `line_id` opcional (padrão: principal) | G | B1 | SQL | 0 | Troca da chave única de `conversations`: expandir → contrair |
| B3 | Tela: conectar/desconectar várias linhas, filtro por linha no Chats, saúde por linha | G | B2, A5 | — | 0 | — |
| B4 | Fila e processamento por linha (`inbound_events` e `outbound_messages` com `line_id`; o processador reparte por linha, com limite por linha por execução) | M | B2, A3, A6 | — | 0 | — |
| B5 | `line_cap` no cadastro de nova linha (servidor manda; 403 acima do limite) | P | B1 | — | 0 | — |

### CF-C — escala
- **C1** registro de servidores Evolution e distribuição de linhas (G, depende de B1/B4; um novo
  serviço Railway por servidor, ~US$ 5–20/mês cada).
- **C2** limite de envio por linha (M, depende de A6).
- **C3** webhooks de saída com fila, reenvio e registro de entregas (= blocos 3 e 4 da Parte 2;
  reaproveita o agendador da A3) (M).
- **C4** teste de carga e capacidade por servidor (M; custo do ambiente de teste).

### CF-D — Cloud API oficial por linha
Linha com `provider = 'evolution' | 'cloud_api'`. Envio e recebimento por adaptador; modelos de
mensagem (HSM) e janela de 24 h. Custo por conversa da Meta. **G**, depende de B2. Fica para quando
houver cliente que exija.

---

## d) Onde entram as pendências atuais
| Pendência | Quando |
| --- | --- |
| **`PLANO-ETIQUETAS`** | **SQL (ET-0)** no arquivo único da CF-A. **ET-1/ET-2** (chaves e API de etiquetas, sem tocar no caminho de mensagens) durante a CF-A. **ET-3/ET-4** (caminho de envio/recebimento e tela) **depois de A6 e antes de B2**: as duas mexem em `sendMessage`/webhook, e a B2 refaz a chave de `conversations` (as etiquetas de conversa precisam existir antes). ET-B (contrair) junto com a contração da B2 |
| P1-S3 / P1-W2 | A7 |
| Limpeza dos dados de teste | fim da CF-A, antes do primeiro cliente pagante |
| Revisão de segurança (histórico da P1-L7, repo privado, troca de chaves) | fim da CF-A (junto com A0/A7) |
| P1-Z (documentação final da Parte 1) | fim da CF-A, já com A1–A6 descritos no `INTEGRATIONS.md` |
| Parte 2 | blocos 3 e 4 = **C3** (reaproveitam A3); demais blocos depois da CF-B |

---

## Chaves por empresa (`companies.features`, jsonb; todas desligadas por padrão)
| Chave | Etapa | Desligada |
| --- | --- | --- |
| `inbound_inbox` | A1/A3 | webhook como hoje |
| `reconcile` | A4 | sem reconciliação para a empresa |
| `send_queue` | A6 | `sendMessage` como hoje |
| `labels` / `block_api_send_on_human` | PLANO-ETIQUETAS | como hoje |

- A leitura é defensiva: coluna ausente ou erro → desligada.
- Cache de 30 s por instância da função.
- **Desliga na hora** com um `update companies set features = features - 'inbound_inbox'`.

## Estado da execução
Ver os relatórios `relatorios/CF-A*.md`.
