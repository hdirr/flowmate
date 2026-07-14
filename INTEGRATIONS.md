# Integrando com o Flowmate

Documentação para quem vai conectar o Flowmate a uma automação externa — n8n, Make, Zapier ou script próprio.

> **Base URL da API:** `https://flowmate-ashy.vercel.app`
> (pode mudar quando o tenant usar domínio próprio — confirme a sua no painel)

---

## Modelo mental (3 frases)

1. O **Flowmate é o gateway único do WhatsApp** — ele é dono da instância da Evolution, do log das conversas e do estado de cada uma.
2. Sua automação é uma **consumidora**, nunca parte do Flowmate — ela não fala com a Evolution nem toca o banco direto.
3. A comunicação tem **dois canais em sentidos opostos**: o **webhook de saída** (Flowmate → você) te avisa que algo aconteceu, e a **API `/v1`** (você → Flowmate) é como você age de volta.

```
  cliente manda WhatsApp
        │
        ▼
   ┌──────────┐   webhook de saída (assinado)   ┌─────────────┐
   │ FLOWMATE │ ───────────────────────────────▶│  sua        │
   │ gateway  │                                  │  automação  │
   │          │◀─────────────────────────────── │  (n8n…)     │
   └──────────┘        API /v1 (x-api-key)       └─────────────┘
```

---

# Parte 1 — Referência técnica (agnóstica de plataforma)

## 1.1 Webhook de saída (Flowmate → você)

O Flowmate faz um `POST` para a URL que você configurar, toda vez que um evento acontece.
Configuração: **Configurações → Integrações → Webhook de saída** (URL de destino + quais eventos).

### Formato do payload

```json
{
  "event_id": "3f2a91c4-0d55-4b1e-9a77-6c2e5b1f0a3d",
  "event": "message.received",
  "data": { "...": "depende do evento" },
  "company_id": "98997d76-c85b-4339-8ae9-ddafdb66a108",
  "timestamp": 1784067000000
}
```

| Campo | Tipo | Observação |
|---|---|---|
| `event_id` | uuid | Único por evento. **Use para deduplicar** (ver Regras). |
| `event` | string | Tipo do evento (tabela abaixo). |
| `data` | object | Conteúdo específico do evento. |
| `company_id` | uuid | O tenant. |
| `timestamp` | número | Unix **milissegundos** (do corpo). ⚠️ diferente do header, ver assinatura. |

### Eventos disponíveis

| `event` | Quando dispara | `data` |
|---|---|---|
| `message.received` | Cliente manda mensagem — **só quando a conversa está em `automation`** | `{ conversation_id, contact_id, remote_jid, from, contact_name, content, message_id, timestamp }` |
| `message.sent` | Qualquer mensagem que o Flowmate envia | `{ conversation_id, contact_id, remote_jid, to, content, media_url, message_id, sender, timestamp }` |
| `contact.created` | Contato criado | `{ contact_id, name, phone, email }` |
| `lead.created` | Lead criado | `{ contact_id, lead_id, ... }` |
| `lead.moved` | Lead mudou de etapa (inclui troca de funil) | `{ contact_id, lead_id, stage_id, pipeline_id, ... }` |

> **Filtro de eventos:** no painel, se você **não marcar nenhum** evento, recebe **todos**. Marcar um ou mais **filtra apenas os marcados**.

### Headers de autenticidade

Todo `POST` vai com:

```
X-Flowmate-Event-Id:   <uuid — igual ao event_id do corpo>
X-Flowmate-Timestamp:  <unix SEGUNDOS>
X-Flowmate-Signature:  sha256=<hex>       (presente quando há segredo configurado)
```

> Cada tenant tem um **segredo de assinatura** gerado automaticamente (visível em Configurações → Integrações → Assinatura). Regenerável a qualquer momento.

### Como verificar a assinatura (HMAC-SHA256)

A assinatura é calculada sobre **`${timestamp_do_header}.${corpo_bruto}`**, onde:

- `timestamp_do_header` = valor de `X-Flowmate-Timestamp` (**segundos** — não o `timestamp` do corpo, que é em ms).
- `corpo_bruto` = os **bytes exatos** recebidos (UTF-8), **sem reserializar**.

```js
const crypto = require('crypto');
const secret = process.env.FLOWMATE_WEBHOOK_SECRET; // o segredo do seu tenant

// rawBody = os bytes EXATOS que chegaram (não JSON.stringify de um objeto parseado)
const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(`${headerTimestamp}.${rawBody}`)
  .digest('hex');

// comparação em tempo constante, com guarda de tamanho
const a = Buffer.from(receivedSignature || '');
const b = Buffer.from(expected);
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  throw new Error('Assinatura inválida');
}
```

> ⚠️ **Reserializar quebra.** Verificar sobre `JSON.stringify(objetoParseado)` funciona por acaso com ASCII e falha em produção com acento/emoji (`João 🦷`), porque os bytes divergem. Sempre verifique sobre o **corpo bruto**.

### Janela anti-replay (5 minutos)

O `timestamp` entra **dentro** do que é assinado, então um `POST` capturado não pode ser reassinado. Recomendamos rejeitar eventos com timestamp fora de uma janela de ~5 min:

```js
if (Math.abs(Date.now() / 1000 - Number(headerTimestamp)) > 300) {
  throw new Error('Timestamp fora da janela');
}
```

> Esta checagem é feita **no seu lado** (consumidor). O Flowmate envia o timestamp assinado; cabe a você aplicar a janela.

---

## 1.2 API `/v1` (você → Flowmate)

### Autenticação

Header `x-api-key` com a chave do tenant (Configurações → Integrações → API de entrada).

```
x-api-key: cf5402db0602435785fa36091f3512f7
```

Chave inválida ou ausente → `401 { "error": "invalid_api_key" }`.

### `POST /v1/messages`

Envia uma mensagem de WhatsApp. **Sempre tratada como automação** (`sender = automation`).

**Request**
```bash
curl -X POST https://flowmate-ashy.vercel.app/v1/messages \
  -H "x-api-key: SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{ "to": "5531999998888", "content": "Olá! Confirmando sua consulta 🦷" }'
```

Mídia (opcional): `"media": { "url": "...", "type": "image|video|document", "mimeType": "...", "fileName": "..." }`.

**Response 200**
```json
{ "ok": true, "message_id": "3EB0...", "conversation_id": "..." }
```

**Erros**

| Status | `error` | Significado |
|---|---|---|
| `401` | `invalid_api_key` | Chave inválida/ausente. |
| `400` | `missing_to` / `missing_content` | Faltou destinatário ou conteúdo. |
| **`409`** | **`conversation_paused`** | **A conversa está em modo humano. Não entregamos nada.** (ver Regras) |
| `502` | `delivery_failed` | A Evolution recusou o envio. |

Resposta do 409:
```json
{ "error": "conversation_paused", "conversation_id": "..." }
```

### `POST /v1/leads`

Cria um lead. **Idempotente por `external_id`** (o id do lead no seu sistema de origem).

**Request**
```bash
curl -X POST https://flowmate-ashy.vercel.app/v1/leads \
  -H "x-api-key: SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "site-form-8842",
    "name": "João da Silva",
    "phone": "31999998888",
    "email": "joao@exemplo.com",
    "pipeline_name": "Funil principal",
    "fields": { "convenio": "Unimed" }
  }'
```

**Response 200**
```json
{ "ok": true, "created": true, "contact_id": "...", "lead_id": "...", "unknown_fields": [] }
```

- `created: false` → o `external_id` já existia; **atualizamos** o contato e devolvemos os mesmos ids (nenhum lead duplicado).
- `unknown_fields` → nomes de campos personalizados que você mandou mas **não existem** no CRM (não são criados automaticamente).

**Erros:** `401 invalid_api_key`, `400 missing_name`.

### Outros endpoints `/v1` (para agentes que leem e escrevem contexto)

| Método + rota | Faz |
|---|---|
| `GET /v1/fields` | Lista os campos personalizados (id, nome, tipo) — para o agente descobrir o que pode escrever. |
| `GET /v1/contacts?phone=` | Lê contato: dados, campos (por nome), tags, lead/etapa e estado da conversa. Também aceita `?id=` ou `?external_id=`. |
| `PATCH /v1/contacts` | Escreve `name`, `email`, `tags`, `fields` (por **id ou nome** do campo) e move de etapa (`stage_id` ou `stage_name` + `pipeline_name`). |
| `GET /v1/messages?phone=&limit=` | Histórico da conversa (contexto para o LLM). |
| `POST /v1/notes` | Registra uma nota interna no contato. |

> Campos personalizados aceitam **id ou nome** (o agente não precisa saber UUID). Campo inexistente volta em `unknown_fields` em vez de ser criado.

---

# Parte 2 — Guia de n8n (passo a passo)

### Passo 1 — Configurar o webhook de saída no Flowmate

1. No Flowmate: **Configurações → Integrações → Webhook de saída**.
2. Em **n8n**, crie um workflow com um nó **Webhook** e copie a **Production URL** dele.
3. Cole essa URL no campo **URL de destino** do Flowmate.
4. Marque os eventos (ex: `message.received`) — ou deixe tudo desmarcado para receber todos. **Salvar**.
5. Copie o **Segredo de assinatura** (mesma tela).

### Passo 2 — Nó Webhook com Raw Body ligado

No nó **Webhook** do n8n → **Options** → ligue **Raw Body**.
Sem isso, o n8n só entrega o JSON já parseado e **você não consegue verificar a assinatura** (a verificação precisa dos bytes originais).

### Passo 3 — Nó Code de verificação

Adicione um nó **Code** logo após o Webhook:

```js
const crypto = require('crypto');
const secret = 'COLE_SEU_SEGREDO_AQUI';

const item = $input.first();

// Corpo BRUTO: com "Raw Body" ligado, chega como binário base64. Nada de JSON.stringify.
const rawBody = Buffer.from(item.binary.data.data, 'base64').toString('utf8');

const ts  = item.json.headers['x-flowmate-timestamp'];
const sig = item.json.headers['x-flowmate-signature'];

const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(`${ts}.${rawBody}`)
  .digest('hex');

const a = Buffer.from(sig || '');
const b = Buffer.from(expected);
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  throw new Error('Assinatura inválida');
}

// anti-replay: rejeita evento com mais de 5 min
if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
  throw new Error('Timestamp fora da janela');
}

// só parseia depois de validar o cru
return [{ json: JSON.parse(rawBody) }];
```

### Passo 4 — Fazer algo e responder

Depois do Code, use o `event` para rotear (um nó **Switch** no campo `event`). Para responder ao cliente, chame a API com um nó **HTTP Request**:

- **Method:** POST
- **URL:** `https://flowmate-ashy.vercel.app/v1/messages`
- **Header:** `x-api-key: SUA_CHAVE`
- **Body (JSON):** `{ "to": "{{ $json.data.from }}", "content": "sua resposta" }`

Se voltar **409 `conversation_paused`**, um humano assumiu a conversa — **pare, não retente** (ver Regras).

---

# Regras para não quebrar o sistema

Comportamentos que **não são óbvios** só olhando os endpoints. Ignorar qualquer um destes gera bug em produção.

### 1. `409 conversation_paused` é esperado, não é erro
Quando a conversa está em modo **humano** (o dono assumiu, pela UI ou respondendo pelo celular), o `POST /v1/messages` volta **409 e não entrega nada** — de propósito. **Não retente em loop.** A conversa está com uma pessoa; sua automação deve recuar até ela voltar para `automation`.

### 2. Deduplique por `event_id`
Trate `event_id` como chave de idempotência: guarde os já processados e **descarte repetidos**. Hoje o Flowmate envia cada evento uma vez, mas o campo existe para quando o **retry** entrar (ver "Planejado"). Sem dedupe, retry vira **agendamento/mensagem duplicada**.

### 3. Nunca fale com a Evolution direto
Todo envio passa por **`/v1/messages`**. É lá que mora a regra de estado (o 409). Se você furar isso e mandar pela Evolution, a IA fala por cima do humano e o Flowmate não tem como impedir.

### 4. Não reaja aos próprios envios
Se você assinar `message.sent`, vai receber de volta as mensagens que **você mesmo** mandou (o campo `sender` diz `automation`). Filtre por `sender` ou simplesmente **não assine `message.sent`** se não precisar — senão vira loop. (`message.received` só dispara para mensagens **do cliente** e só em modo automação, então não causa loop.)

### 5. Idempotência de lead por `external_id`
Ao criar leads, **sempre mande `external_id`** (o id no seu sistema de origem). Sem ele, um workflow que re-executa em erro cria o mesmo contato 3 vezes — e dispara 3 "olá". Com ele, a 2ª chamada volta `created: false` e o mesmo `contact_id`.

---

# Planejado — ainda **não** disponível

Documentado aqui para deixar claro o que **não** existe hoje, para você não desenhar assumindo que existe:

- **Retry de webhook.** Hoje a entrega é *fire-and-forget*: se o seu endpoint estiver fora do ar quando o evento dispara, **o evento se perde**. (Por isso o `event_id` já existe — para dedupe quando o retry chegar.)
- **Fila / buffer de eventos.** Uma rajada de mensagens gera uma rajada de `POST`s simultâneos, sem enfileiramento.
- **Múltiplas URLs de webhook por tenant.** Hoje é **uma** URL por empresa; roteie por `event` dentro do n8n.

O que **já existe e é estável**: assinatura HMAC, `event_id` no payload, janela anti-replay (verificação no consumidor), o 409 de estado, e a idempotência de lead por `external_id`.
