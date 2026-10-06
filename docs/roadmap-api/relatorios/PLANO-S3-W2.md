# Plano — destravar P1-S3 e P1-W2 (troca da chave da Evolution + `WEBHOOK_SECRET`)

**Status:** só plano, **nada executado**. Quem executa é o Agadir, com o tutor.
**Nenhum valor de segredo neste arquivo.** Os valores novos vão direto para o cofre da empresa
e para os painéis (Railway / Vercel), nunca para o chat, o repo ou um print.

## Como as peças se falam (o que pode quebrar)
| Direção | Usa | Se ficar descasado |
| --- | --- | --- |
| Vercel → Evolution (enviar, sync, status, QR, grupos, mídia) | `EVOLUTION_API_KEY` na Vercel = `AUTHENTICATION_API_KEY` no serviço `evolution-api` do Railway | **envio para** (502), status/QR falham; o **recebimento continua** |
| Evolution → Vercel (mensagens recebidas, conexão) | URL do webhook gravada **dentro da Evolution**, por instância, com `?secret=` quando a Vercel tem `WEBHOOK_SECRET` | a Vercel responde 401 e **o recebimento para** até a URL ser regravada |

- A URL do webhook só é regravada na Evolution quando alguém clica **Conectar**
  (Configurações → WhatsApp) ou **Importar conversas** (Chats), por empresa.
- **Hoje o código já recusa** (401) quando `WEBHOOK_SECRET` existe e o segredo não vem.
  - Então ligar a variável **antes** de regravar a URL derruba o recebimento nesse intervalo.
  - As mensagens desse intervalo ficam na Evolution e voltam com **Importar conversas**
    (janela de 7 dias), mas **não disparam** `message.received` nem a pausa pelo celular.
- **Atenção à imagem `:latest`:** mudar variável no Railway faz redeploy do serviço. Com
  `evoapicloud/evolution-api:latest`, esse redeploy pode baixar uma versão nova da Evolution junto
  com a troca. Por isso o passo 0 fixa a versão.

## Ordem recomendada (4 janelas separadas, cada uma validada antes da próxima)
Fazer em horário de pouco movimento, com as automações que enviam WhatsApp pausadas e o celular
da empresa à mão (caso peça QR). Antes de cada janela: anotar o valor **atual** no cofre (é o
rollback).

### Janela 0 — fixar a versão da Evolution (pré-requisito)
1. Railway → `evolution-api` → Settings → Source/Image: trocar `:latest` pela tag da versão
   em uso (hoje **v2.3.7**; conferir a versão real em `GET /` da Evolution ou nos logs de boot).
2. Redeploy. Esperar o serviço ficar "Active".
3. **Validar** (lista V abaixo). **Rollback:** voltar a imagem anterior.

### Janela 1 — trocar `EVOLUTION_API_KEY` (troca da chave fraca)
1. Gerar a chave nova (aleatória, só letras e dígitos; ex.: 64 hex) e guardar no cofre como
   "Evolution — nova", sem apagar a "atual".
2. **Railway primeiro:** `evolution-api` → Variables → `AUTHENTICATION_API_KEY` = nova. Isso
   reinicia a Evolution (1–2 min). A partir daqui a Vercel não consegue enviar (chave velha).
3. **Vercel logo em seguida:** Settings → Environment Variables → `EVOLUTION_API_KEY`
   (Production) = nova → **Redeploy** do último deployment de produção.
4. Janela de envio parado esperada: **~2–4 min**. Recebimento: só o tempo do restart da Evolution.
5. **Validar** (lista V), mais:
   - `curl` na Evolution com a chave **velha** → 401 (a velha morreu);
   - com a **nova** → 200.
   - Rodar da máquina do Agadir, sem colar a chave no chat.
6. **Rollback:**
   - Railway volta o valor antigo;
   - Vercel volta o antigo + Redeploy, ou **Instant Rollback** para o deployment anterior. O
     deployment guarda as variáveis do momento do build; confirmar no painel.
7. Depois de validado: apagar a chave velha do cofre e de qualquer arquivo local (inclusive
   `.claude/settings.local.json`, que já guardou comandos com ela).

### Janela 2 — `WEBHOOK_SECRET` sem buraco no recebimento
**Recomendado: transição em 2 deploys** (exige uma mudança pequena de código, que eu faço
quando liberarem):
1. **Código "modo transição"** (deploy antes de mexer em variável):
   - com `WEBHOOK_SECRET` definido, a Vercel **grava** a URL com `?secret=`;
   - **aceita** POST sem segredo, só logando `[webhook] sem segredo (transição)`;
   - com segredo **errado** → 401;
   - controlado por uma variável `WEBHOOK_SECRET_ENFORCE` (ausente = transição).
2. Gerar o segredo (aleatório, só letras e dígitos, ≥ 32 bytes em hex; vai na URL) → cofre.
3. Vercel: criar `WEBHOOK_SECRET` (Production) → Redeploy.
4. FlowMate → Chats → **Importar conversas** (regrava a URL com `?secret=`), em **cada** empresa
   com WhatsApp conectado. Hoje é 1.
5. Mandar uma mensagem de outro aparelho → aparece no Chats. Nos logs da Vercel **não** pode
   aparecer mais `sem segredo (transição)` depois disso.
6. Esperar um tempo combinado (ex.: 24 h) sem nenhum log de transição.
7. **P1-S3 (código):**
   - sem `WEBHOOK_SECRET` → 503 + log `recusado: WEBHOOK_SECRET não configurado`;
   - comparação em tempo constante;
   - segredo ausente/errado → 401;
   - aceita `?secret=` e `x-webhook-secret`.
   - Deploy. Com a variável `ENFORCE` ou removendo o modo transição, conforme o tutor preferir.
8. **Validar** (lista V), mais:
   - `curl -X POST .../api/whatsapp/webhook` sem segredo → 401;
   - mensagem real chega.

**Alternativa sem código novo** (aceita um buraco curto):
1. Criar `WEBHOOK_SECRET` + Redeploy.
2. **Imediatamente** Importar conversas.
3. Mensagens que chegarem nesse intervalo (~1–3 min) ficam sem `message.received`/pausa pelo
   celular; o histórico volta pelo Importar.

**Rollback (as duas formas):**
- apagar `WEBHOOK_SECRET` na Vercel + Redeploy;
- **Importar conversas** (regrava a URL sem `?secret=`);
- se a P1-S3 já estiver no ar, reverter o commit da S3 antes (com ela, variável vazia = 503 em
  tudo).

### Janela 3 — P1-W2 (`whatsapp.connection`)
Só depois da S3 validada. É código meu, no ramo `connection.update` do webhook (roteiro `15`):
- ler o status anterior;
- manter o `upsert`;
- disparar `{ status, phone, instance }` só em `open`/`close` quando mudou;
- passar o evento para `available: true` no catálogo.

**Teste (Agadir):** desconectar e reconectar o número de teste → no webhook.site, um
`disconnected` e um `connected`, sem repetição.

## Lista V — validação depois de cada janela
1. Configurações → WhatsApp: **conectado** (se pedir QR, escanear; a sessão do Baileys deveria
   sobreviver ao restart).
2. **Receber:** mensagem de outro aparelho aparece no Chats em segundos (smoke 1.8).
3. **Enviar pela tela:** uma mensagem para um número **seu** chega no celular.
4. **Pausa:** responder pelo celular → a conversa vira "humano" (`conversation.state_changed`,
   `changed_by: "phone"`).
5. **Smoke da /v1** idêntico ao anterior (eu rodo, se me pedirem).
6. Logs da Vercel (`/api/whatsapp/*`) sem 401/502 novos.

## Fora deste plano (lembrar no fim da Parte 1)
- Trocar o `VERCEL_BYPASS_TOKEN` e regenerar a chave de teste da API (`FLOWMATE_TEST_KEY`).
- Organizar os segredos no cofre da empresa (Evolution, `WEBHOOK_SECRET`, Supabase,
  AbacatePay).
