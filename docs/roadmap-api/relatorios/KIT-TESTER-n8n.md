# Kit do tester — n8n + FlowMate (API `/v1` e webhooks)

Para quem vai integrar o n8n ao FlowMate numa empresa de teste. Tudo aqui usa valores de
exemplo: **troque `SUA_CHAVE`, `<LEAD_ID>` etc. pelos seus**. A chave e o segredo de assinatura
ficam em **Configurações → Integrações**, na sua empresa no FlowMate.

## 1. O básico
- **URL base:** `https://flowmate-ashy.vercel.app/v1`
- **Formato:** JSON, UTF-8. Datas em ISO 8601 (UTC). `timestamp` de mensagem em segundos.
- **Envie sempre `Content-Type: application/json`** em POST e PATCH, com JSON válido. Um corpo que
  não é JSON é recusado antes de chegar à API: **400 com o corpo vazio**, sem `error`.
- **Isolamento:** a chave só enxerga a sua empresa. Um id de outra empresa responde **404**,
  nunca 403.
- **Modelo mental:** o FlowMate é o único caminho para o WhatsApp. O n8n **nunca** fala com a
  Evolution nem com o banco: **entra pela `/v1` e recebe webhooks**.

## 2. Autenticação: um header só
Use **um** destes, nunca os dois juntos:
```
x-api-key: SUA_CHAVE
Authorization: Bearer SUA_CHAVE
```
- O Bearer aqui é **a chave da integração**, não um JWT.
- Se vierem os dois, vale o primeiro preenchido, na ordem `x-api-key` → `Bearer` → `?key=`.
  Uma `x-api-key` errada derruba a chamada mesmo com o Bearer certo.
- No n8n: credencial **Header Auth** (`x-api-key`) ou **Bearer Auth**.
- Chave inválida ou ausente → `401 { "error": "invalid_api_key" }`.

## 3. Convenções
- **Listas paginadas** (padrão Helena): query `pageNumber` (padrão 1) e `pageSize` (padrão 20,
  máximo 100). Resposta:
  ```json
  { "pageNumber": 1, "pageSize": 20, "totalPages": 3, "totalItems": 47, "hasMorePages": true, "items": [ ] }
  ```
  - página além do fim → `items: []`;
  - `pageSize` acima de 100 vira 100.
- **Erros das rotas novas:** `{ "error": "codigo", "message": "texto" }`. Os principais:

  | Status | Códigos |
  | --- | --- |
  | 400 | `invalid_filter`, `invalid_date`, `invalid_field`, `invalid_body`, `empty_update`, `invalid_state`, `invalid_tags`, `invalid_operation`, `stage_not_found`, `missing_text`, `text_too_long`, `missing_content` |
  | 401 | `invalid_api_key` |
  | 404 | `*_not_found`; rota inexistente → `not_found` |
  | 405 | `method_not_allowed` |
  | 409 | `conversation_paused` |
  | 422 | `unsupported_for_group`, `unsupported_jid`, `lead_without_contact` |
  | 502 | a Evolution recusou o envio |

- **Ids:** contatos, leads, conversas etc. são UUID; um id que não é UUID responde 404. O
  `messageId` é o id do WhatsApp (letras e dígitos, até 128 caracteres, diferencia maiúsculas).
- **Mensagens:** o FlowMate guarda **só 7 dias**. O mais antigo fica no WhatsApp e não sai pela
  API.

## 4. Rotas disponíveis

### Leitura
| Rota | O que devolve | Filtros e observações |
| --- | --- | --- |
| `GET /pipelines` | Funis com etapas, na ordem da tela | — |
| `GET /leads` | Leads paginados, mais novos primeiro | `pipelineId`, `stageId`, `contactId`, `priority`, `createdAfter/Before`, `updatedAfter/Before` |
| `GET /leads/{id}` | Um lead com o contato completo (`fields` por nome) | `value` hoje vem 0 (o app ainda não edita) |
| `GET /leads/{id}/notes` | Notas do contato do lead, mais novas primeiro | `user_id` nulo = nota de automação ou da API |
| `GET /contacts` | Contatos paginados | `name` (contém, sem caixa), `tag` (**exata, diferencia maiúsculas**), datas |
| `GET /contacts?phone=` \| `?id=` \| `?external_id=` | Um contato + lead + estado da conversa | rota antiga, resposta própria |
| `GET /users` | Usuários (`id, name, email, role, active`) | — |
| `GET /conversations` | Conversas paginadas | `state` (`automation`/`human`), `type` (`individual`/`group`), `contactId`, `updatedAfter/Before` |
| `GET /conversations/{id}` | Uma conversa + `last_message` | `last_message: null` é comum (7 dias) |
| `GET /conversations/{id}/messages` | Mensagens da conversa | `order=desc` (padrão) ou `asc` |
| `GET /messages/{messageId}` | Uma mensagem pelo id do WhatsApp | — |
| `GET /messages?phone=&limit=` | Histórico por telefone | rota antiga |
| `GET /fields` | Campos personalizados (id, nome, tipo) | — |
| `GET /webhook-events` | Catálogo de eventos, com `available` | ver seção 5 |

**Sobre conversas:**
- **`updated_at`** é a **última mudança de estado**, não a última mensagem.
- **`@lid`** é um identificador novo do WhatsApp: a conversa é individual, mas `phone` vem
  `null`.
- **`contact`** só vem quando a conversa tem `contact_id`; hoje a maioria vem `null`.

### Escrita
| Rota | Corpo | Observações |
| --- | --- | --- |
| `POST /messages` | `{ "to": "5531999998888", "content": "Olá!" }` (+ `media` opcional) | **409 `conversation_paused`** se a conversa estiver em `human`: é esperado, não reenvie |
| `POST /leads` | `{ "external_id": "seu-id", "name": "…", "phone": "…", "fields": {…} }` | idempotente por `external_id` (`created: false` = já existia, foi atualizado) |
| `PATCH /contacts` | `{ "phone": "…", "name": "…", "tags": […], "fields": { "Nome do campo": "valor" } }` | campos por **id ou nome**; inexistente volta em `unknown_fields` |
| `POST /notes` | `{ "phone": "…", "text": "…" }` | nota interna no contato |
| `PATCH /leads/{id}` | `{ "stage_name": "Negociação", "pipeline_name": "Funil principal", "priority": true, "value": 1500 }` | move de etapa e funil; `metadata` ainda não |
| `POST /leads/{id}/notes` | `{ "text": "Cliente pediu proposta", "user_id": "<USER_ID>" }` | nota no contato do lead; `user_id` (autor) opcional, de `GET /users`; 201 com a nota |
| `POST /contacts/{id}/tags` | `{ "tags": ["vip"], "operation": "InsertIfNotExists" }` | também `DeleteIfExists` e `ReplaceAll`. **Tags diferenciam maiúsculas: `VIP` e `vip` são tags diferentes** |
| `PATCH /conversations/{id}` | `{ "state": "human" }` ou `{ "state": "automation" }` | grupo → 422; gera `conversation.state_changed` (`changed_by: "api"`) |
| `POST /conversations/{id}/messages` | `{ "content": "Olá!" }` (+ `media` opcional) | envia pela conversa (serve para grupo); **409** se a conversa estiver em `human`; `@lid` → 422 `unsupported_jid` |

Exemplo curto (n8n → nó HTTP Request ou `curl`):
```bash
curl -X PATCH "https://flowmate-ashy.vercel.app/v1/leads/<LEAD_ID>" \
  -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{ "stage_name": "Negociação" }'
```

**Ainda não existem:**
- criar contato sem lead (`POST /contacts` novo);
- `metadata`.

**Ações feitas pela API não disparam as automações da tela** (os webhooks disparam).

## 5. Webhooks (FlowMate → n8n)
Configure em **Configurações → Integrações → Webhook de saída** a URL do seu nó Webhook do n8n.
Se **nenhum** evento estiver marcado, você recebe **todos**, inclusive os que forem criados
depois. Marcar filtra. **Sempre roteie pelo campo `event`.**

**Eventos que saem hoje** (`GET /v1/webhook-events` → `available: true`):

| `event` | Quando |
| --- | --- |
| `message.received` | Cliente mandou mensagem, **só com a conversa em `automation`** |
| `message.sent` | O FlowMate enviou uma mensagem (campo `sender`: `automation` \| `human`) |
| `contact.created` | Contato criado na tela |
| `lead.created` | Lead criado (tela ou `POST /leads`) |
| `lead.moved` | Lead mudou de etapa ou de funil |
| `lead.updated` | Lead alterado pela API (`PATCH /leads/{id}`), com `changes` |
| `contact.tags_updated` | Tags alteradas pela API (`POST /contacts/{id}/tags`), com `added`/`removed` |
| `note.created` | Nota criada pela API (`POST /leads/{id}/notes`) |
| `conversation.state_changed` | Conversa mudou entre `automation` e `human`; `changed_by`: `user` (tela), `phone` (respondeu pelo celular) ou `api`; `previous_state` e `user_id` |

**Ainda não saem** (`available: false`): `contact.updated`, `whatsapp.connection`. Assinar não
dá erro, mas nada chega. A tela de Integrações mostra só os eventos que já saem.

**Envelope** de todo POST:
```json
{ "event_id": "uuid", "event": "lead.moved", "data": { }, "company_id": "uuid", "timestamp": 1790000000000 }
```
**Headers:** `X-Flowmate-Event-Id`, `X-Flowmate-Timestamp` (segundos),
`X-Flowmate-Signature: sha256=<hex>`.

### Validar a assinatura (HMAC) + anti-replay no n8n
1. No nó **Webhook**: **Options → Raw Body** ligado. Sem isso, a verificação falha com acentos e
   emojis.
2. Logo depois, um nó **Code** com:
```js
const crypto = require('crypto');
const secret = 'COLE_SEU_SEGREDO_AQUI'; // Configurações → Integrações → Assinatura

const item = $input.first();

// Corpo BRUTO (Raw Body ligado chega como binário base64). Nada de JSON.stringify.
const rawBody = Buffer.from(item.binary.data.data, 'base64').toString('utf8');

const ts  = item.json.headers['x-flowmate-timestamp'];
const sig = item.json.headers['x-flowmate-signature'];

const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(`${ts}.${rawBody}`)
  .digest('hex');

// comparação em tempo constante, com guarda de tamanho
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
O mesmo exemplo aparece na tela de Integrações, já com o seu segredo.

## 6. Regras de ouro
1. **409 `conversation_paused` é esperado:** um humano assumiu a conversa. Não reenvie.
2. **Deduplique por `event_id`.** O mesmo evento pode chegar duas vezes.
3. **Não reaja aos próprios envios:** o `message.sent` com `sender: "automation"` é seu.
4. **Conversa em `human` não gera `message.received`** e **não volta sozinha** para
   `automation`. Retome com `PATCH /conversations/{id}` `{ "state": "automation" }` ou pela tela.
   Assine `conversation.state_changed` para saber quando um humano assume ou devolve.
5. **Idempotência de lead:** use sempre o mesmo `external_id`.
6. **Sem limite de requisições ainda, mas seja gentil:** no máximo algumas por segundo.

## 7. Como reportar problemas
Mande ao Agadir:
- a rota;
- o horário (UTC);
- o status e o corpo da resposta, **sem a chave**;
- o `event_id` (se for webhook).

Não mande prints com a chave ou o segredo.
