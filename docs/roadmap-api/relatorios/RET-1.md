# RET-1 — Retenção e peso dos dados (atrás de `DATA_RETENTION`, desligada)

**Status:** código pronto, **desligado** (a variável `DATA_RETENTION` não existe na Vercel).
Desligada, o processador faz exatamente o de antes (inclusive a limpeza antiga da caixa de
entrada: concluídos com mais de 30 dias). **SQL:** `supabase_retencao.sql`, **não rodado**: a
PARTE 0 é só leitura (tamanhos); a PARTE 1 (índices) é opcional, antes de ligar; a PARTE 2 vai
depois da PARTE 7 da CF-A. O job ainda não roda sozinho (PARTE 7 da CF-A pendente).

## 1. Limpeza automática no processador (`POST /api/whatsapp/jobs`)
- **`api/_lib/retention.js` (novo):**

  | Tabela | Apaga | Fica sempre |
  | --- | --- | --- |
  | `inbound_events` | `done`/`ignored` com mais de **7 dias** (`received_at`) | `pending`, `processing`, `failed`, `dead` |
  | `outbound_messages` | `sent` com mais de **30 dias** (`created_at`) | `pending`, `sending`, `failed`, `dead` |
  | `ops_alerts` | resolvidos há mais de **90 dias** (`resolved_at`) | abertos (`resolved_at` nulo), de qualquer idade |

- **Lotes pequenos:**
  - lê até 100 ids (os mais antigos) e apaga **por id**, repetindo o filtro no delete. Uma
    linha que mudou de estado entre a leitura e o delete não sai;
  - no máximo 5 lotes por tabela e por execução (500 linhas);
  - apagar por chave primária, poucas linhas por vez, não segura a tabela.
- **Tempo:**
  - roda **por último** no job, depois de caixa de entrada, fila, reconciliação e alertas;
  - só começa se o job ainda estiver antes de 8,5 s, com prazo próprio de 1,5 s (teto 9 s
    desde o início do job). Sem tempo, para e continua na próxima execução;
  - em dia, roda no máximo **a cada 10 min** (por instância da função). Com atraso (bateu os
    500 ou o prazo), a execução seguinte não espera.
- **Erro** numa tabela fica no resumo e no log (`[retention] …`) e não impede as outras.
- **`/jobs`:** com a variável ligada, a resposta e o log `[jobs]` ganham `retention`
  (`{ inbound_events: { deleted, more? }, … }`), e a limpeza antiga da caixa de entrada (30
  dias, sem lote) deixa de rodar: a retenção cobre os mesmos casos com 7 dias.
- **Efeito colateral conhecido:** uma `Idempotency-Key` repetida **depois de 30 dias** envia
  de novo (a linha que guardava o resultado saiu). Dentro de 30 dias, nada muda.

## 2. Mídia em base64 e consulta de tamanhos
**Conferido no código:**
- **Recebida:**
  - o webhook é configurado com `base64: false` (`webhookConfig`), então a Evolution não
    manda o arquivo no evento;
  - o arquivo só é baixado sob demanda (`POST /api/whatsapp/media`): o base64 que a Evolution
    devolve vira `Buffer`, sobe para o Storage (bucket `whatsapp-media`) e a tabela guarda
    **só a URL** (`media_url`).
- **Enviada pela tela e pelas automações:** o arquivo sobe direto do navegador para o Storage
  (`Chats.jsx`, `Automations.jsx`), e o servidor recebe só a URL.
- **`/sync`, `/history` e reconciliação:** gravam só texto e tipo (`parseMessage`), nunca o
  arquivo.

**Dois achados (não corrigidos nesta etapa; ficam registrados):**
1. **A `/v1` aceita qualquer texto em `media.url`**, inclusive `data:…;base64,…`. A Evolution
   aceita base64 no `sendMedia`. Se uma integração mandar assim, o base64 vai para
   `whatsapp_messages.media_url` e, com a fila ligada, para `outbound_messages.media`. Hoje
   nenhuma integração conhecida faz isso (a consulta 0.4 confirma). Correção proposta, em
   etapa própria porque muda o contrato: recusar com 400 `invalid_field` o que não começar com
   `https://` (ou `http://`), com aviso no `INTEGRATIONS.md`.
2. **`inbound_events.payload` guarda a mensagem crua da Evolution**, que em imagem/vídeo traz a
   miniatura `jpegThumbnail` (base64, alguns KB). Com a retenção de 7 dias isso deixa de
   acumular. Tirar a miniatura antes de gravar é possível, mas mexe no "cru" da caixa de
   entrada: só se a consulta 0.2 mostrar `inbound_events` pesando.

**Consulta (só leitura):** `supabase_retencao.sql`, PARTE 0:
- 0.1 tamanho do banco;
- 0.2 as 25 tabelas que mais ocupam (dados, índices, TOAST, linhas estimadas), em todos os
  esquemas (inclui `auth`, `storage`, `cron`, `net`);
- 0.3 os 25 índices que mais ocupam;
- 0.4 mídia em base64 em tabela (esperado: tudo 0);
- 0.5 quantas linhas a limpeza apagaria hoje.

A mesma 0.2/0.3 serve para o Postgres da Evolution, no Railway (ver o item 4).

**Achado extra (pg_cron):** com a PARTE 7 da CF-A, o agendador roda a cada minuto e o pg_cron
guarda uma linha por execução em `cron.job_run_details`, **para sempre** (≈ 1.440 linhas/dia).
A PARTE 2 do SQL agenda a limpeza diária (mais de 7 dias). Rodar só depois da PARTE 7.

## 3. Logs
Novo `api/_lib/log.js`:
- `debug(…)` só escreve com **`DEBUG_LOGS=on`** na Vercel;
- erros e avisos continuam sempre.

| Log | Antes | Agora |
| --- | --- | --- |
| `[webhook] msg jid=… id=…` (1 por mensagem, com o número) | sempre | só `DEBUG_LOGS=on` |
| `[webhook] event=… instance=…` (1 por chamada) | sempre | só `DEBUG_LOGS=on` |
| `[webhook] messages.upsert n=…` e `… processadas em …` | sempre | só `DEBUG_LOGS=on` |
| `[webhook] inbox … → 200` | sempre | só `DEBUG_LOGS=on`; **diferente de 200 vira aviso, sempre** |
| `[webhook] messages.upsert sem dados` | log | aviso (sempre) |
| `[synctrace <id>] auth/findChats/…` (6 tempos por sync) | sempre | `[sync <id>] … até Nms`, só `DEBUG_LOGS=on` |
| `[synctrace] total …` | sempre | `[sync] total …`, sempre (1 linha por sync) |
| `[synctrace <id>] prune ignorado` | aviso | `[sync <id>] prune ignorado`, aviso |
| `[jobs] …` (1 por execução) | sempre | sempre (é o batimento do agendador) |
| erros `[webhook] insert falhou`, `[inbox]`, `[whatsapp] … falhou`, `[sync]`, `[retention]` | sempre | sempre |

## 4. Proposta: quanto a Evolution precisa guardar (`DATABASE_SAVE_*`)
Só texto; nada mudado no Railway. **"A confirmar"** = não verifiquei na Evolution em uso.

**O que o FlowMate lê da Evolution hoje** (todas as chamadas no código):
- `chat/findMessages`:
  - `/history` (rolagem para trás, além dos 7 dias do Supabase);
  - "Importar conversas" (sync);
  - reconciliação (A4);
- `chat/findChats`: o sync;
- `chat/getBase64FromMediaMessage`: download de mídia sob demanda. A Evolution procura a
  mensagem **no banco dela** (precisa da chave da mídia guardada);
- `group/findGroups`, `instance/connectionState`, `message/send*`, `group/create`,
  `webhook/set`: ao vivo, não dependem do que está guardado.

Ninguém lê status de entrega/leitura, contatos nem etiquetas do WhatsApp guardados na
Evolution.

| Variável | Padrão da Evolution (valor no Railway a confirmar) | Proposta | Por quê |
| --- | --- | --- | --- |
| `DATABASE_SAVE_DATA_INSTANCE` | true | **true** | a instância |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | true | **true** | `/history`, sync, reconciliação e mídia leem daqui. Desligar quebra os quatro |
| `DATABASE_SAVE_DATA_CHATS` | true | **true** | o sync usa `findChats` |
| `DATABASE_SAVE_MESSAGE_UPDATE` | true | **false** | uma linha por mudança de status (entregue, lida…), várias por mensagem enviada. O FlowMate não lê nem assina `MESSAGES_UPDATE`. **Maior ganho sem perda** |
| `DATABASE_SAVE_DATA_LABELS` | true | **false** | etiquetas do WhatsApp Business; o FlowMate tem as próprias |
| `DATABASE_SAVE_DATA_CONTACTS` | true | true (pode ir a false) | pequeno; a confirmar se o `findChats` da 2.3.7 usa o nome do contato guardado |
| `DATABASE_SAVE_DATA_HISTORIC` | true | **true + poda** (abaixo) | foi o que encheu os 500 MB em 09/2026. Desligar = conversas anteriores ao pareamento não aparecem no `/history` nem no primeiro "Importar conversas". Melhor manter e podar |

**Poda (depois que a A4 estiver estável):**
- **Condição para "estável":** reconciliação ligada há 2+ semanas, contagem da Evolution
  batendo com `whatsapp_messages` nas janelas conferidas, `recovered` perto de zero e sem
  `last_error`.
- **Por que só então:** a Evolution deixa de ser o único caminho para recuperar mensagem
  perdida. O Supabase tem os 7 dias, e a A4 confere de 5 em 5 min.
- **A Evolution 2.3.7 não tem prazo automático para mensagens** (a confirmar). A poda seria uma
  tarefa diária no Postgres da Evolution (Railway): apagar `Message` (e `MessageUpdate`, se
  ficar ligado) com mais de **N dias**.
- **N é decisão de produto:** é até onde a rolagem do `/history` volta. Proposta: **90 dias**.
- O nome das tabelas e colunas do esquema Prisma da 2.3.7 fica a confirmar antes de escrever
  esse SQL.

**Efeito no volume de 5 GB (estimativa, a confirmar com a consulta 0.2/0.3 no Postgres da
Evolution):**
- **Quanto pesa cada coisa:**
  - mensagem de texto: ~1–2 KB (JSON da mensagem + índices);
  - mídia: alguns KB a mais (miniatura em base64 dentro do JSON; o arquivo não fica no banco
    com `base64: false`, a confirmar);
  - `MessageUpdate`: 2–3 linhas por mensagem enviada.
- **Linha com ~1.000 mensagens/dia:** ~1,5–3 MB/dia, ou seja, **~0,5–1 GB/ano por linha, sem
  poda**.
- **Pareamento novo com histórico:** pode trazer **centenas de MB de uma vez** (o incidente de
  09/2026 foi um pareamento). Com vários clientes, isso enche o volume mais rápido que o dia a
  dia.
- **Com `MESSAGE_UPDATE=false`:** corta a parte de status (estimativa: 20–40 % do que cresce
  por mensagem enviada).
- **Com a poda de 90 dias:**
  - cada linha estabiliza em ~150–300 MB;
  - o histórico que chega no pareamento é aparado na primeira noite;
  - cabem **~10–20 linhas movimentadas** em 3,5 GB (70 % do volume, o limite do alerta da A5).
- **Espaço livre:** o Postgres reaproveita o espaço apagado (autovacuum), mas o arquivo não
  encolhe sozinho. O volume para de crescer em vez de diminuir.
- **Ordem sugerida:**
  1. junto com a janela 0 (fixar a imagem; `PLANO-S3-W2.md`): `MESSAGE_UPDATE=false` e
     `LABELS=false` (sem perda);
  2. medir com a 0.2/0.3 no Postgres da Evolution;
  3. com a A4 estável, decidir N e criar a poda.

## Como testei
- **Local: 23/23** (`retlocal.mjs`, banco falso, dados fictícios):
  - **desligada por padrão:** sem a variável e com `ON` maiúsculo; liga só com `on`;
  - **regras de cada tabela:**
    - entrada: apaga `done`/`ignored` > 7 d; ficam 6 d, `failed`, `dead`, `pending` e
      `processing`;
    - fila: apaga `sent` > 30 d; ficam 29 d e as não enviadas;
    - alertas: apaga resolvido > 90 d; ficam 89 d e aberto antigo;
  - **lotes:** 1.234 linhas antigas viram 500 + 500 + 234 em três execuções seguidas; os
    deletes têm no máximo 100 ids, e os mais antigos saem primeiro;
  - **intervalo:** em dia, não roda de novo antes de 10 min; depois de 10 min, roda;
  - **prazo esgotado:** nenhuma consulta, nada apagado, marca que sobrou;
  - **erro em uma tabela** não impede a outra;
  - **linha que mudou de estado** entre a leitura e o delete não sai;
  - **`processDueEvents`:** `cleanup: false` não apaga; o padrão mantém a limpeza antiga de 30
    dias;
  - **`debug`** só escreve com `DEBUG_LOGS=on`.
- **Regressões:** caixa de entrada 35/35, A2 5/5, reconciliação 24/24, saúde 19/19, fila 32/32,
  E0b 24/24, E0 42/42, etiquetas 101/101 e ET-3 32/32. `npm run build` ok.
- **Produção:** ver o fim deste relatório.

## Para ligar (Agadir)
1. **PARTE 0** do `supabase_retencao.sql` (só leitura) e me mandar o resultado: tamanhos e
   base64.
2. **PARTE 1** (índices; opcional, instantâneo hoje).
3. **PARTE 7** da CF-A (agendador), se ainda não tiver rodado. Sem ela, o job não roda.
4. **`DATA_RETENTION=on`** na Vercel (Production) e redeploy.
5. **Primeira conferência:**
   - no log `[jobs]`, `retention` com `deleted` coerente com a consulta 0.5;
   - em seguida, a 0.5 de novo, esperando 0 (ou só o que venceu depois).
6. **PARTE 2** (limpeza do `cron.job_run_details`), depois da PARTE 7.

**Desligar:** tirar `DATA_RETENTION` (ou mudar o valor) e redeploy. Volta a limpeza antiga de
30 dias da caixa de entrada.
**Logs detalhados para diagnóstico:** `DEBUG_LOGS=on` e redeploy; tirar depois.

## Produção (`22da0cc`, deploy confirmado pelo status do GitHub)
| Caso | Resultado |
| --- | --- |
| `GET /api/whatsapp/jobs` | 405 |
| `POST /api/whatsapp/jobs` (sem `JOBS_SECRET`) | 503 |
| `GET /api/whatsapp/health?probe=1` | 200 |
| `GET /api/whatsapp/connect` / `qualquer_coisa` | 405 / 404 |
| Smoke | **idêntico** ao de antes do deploy |

**Revisor:** aprovado com ressalvas, nenhuma de código. (1) Contrato: a `Idempotency-Key` vale
30 dias com a retenção ligada; corrigido no mesmo commit (`20-contrato-api-v1.md`). (2) HANDOFF
citava `[synctrace]`; corrigido no commit de docs.
