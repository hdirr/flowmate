# 20 — Contrato das rotas novas da `/v1` (Parte 1)

Base: `https://flowmate-ashy.vercel.app/v1`. Autenticação: `x-api-key: SUA_CHAVE` **ou**
`Authorization: Bearer SUA_CHAVE`. Tudo em JSON, UTF-8. Toda consulta é filtrada pela empresa da
chave; um id de outra empresa responde **404**, nunca 403 (não revelamos que existe).

Nomes de campo: os **objetos** seguem o banco (`snake_case`); os **parâmetros de paginação e
filtro** seguem a Helena (`pageNumber`, `pageSize`, `createdAfter`...). É de propósito.

## Convenções

### Lista paginada
Query: `pageNumber` (padrão 1), `pageSize` (padrão 20, máximo 100).
```json
{ "pageNumber": 1, "pageSize": 20, "totalPages": 3, "totalItems": 47, "hasMorePages": true, "items": [ ... ] }
```

### Erro
```json
{ "error": "lead_not_found", "message": "Lead não encontrado." }
```
| Status | Quando |
| --- | --- |
| 400 | Parâmetro inválido ou faltando (`invalid_date`, `invalid_filter`, `missing_text`, `invalid_state`...) |

`invalid_filter`: filtro de id que não é UUID (`pipelineId`, `stageId`, `contactId`...) ou booleano
diferente de `true`/`false` (`priority`). A `message` diz qual filtro. Um filtro **válido** de outra
empresa não é erro: devolve lista vazia.
| 401 | `invalid_api_key` |
| 404 | Recurso não existe nesta empresa (`*_not_found`) ou rota inexistente (`not_found`) |
| 405 | `method_not_allowed` |
| 409 | Conflito: `contact_exists`, `conversation_paused` |
| 422 | Entendido mas não executável (`unsupported_jid`) |
| 502 | A Evolution recusou (`delivery_failed`) |

### Objetos

**Contato**
```json
{ "id": "uuid", "external_id": "site-8842", "name": "João", "phone": "5531999998888",
  "email": "j@x.com", "tags": ["vip"], "fields": { "Convênio": "Unimed" },
  "metadata": { "erp_id": "C-77" }, "created_at": "ISO", "updated_at": "ISO" }
```
`fields` sai **por nome** do campo (como no `GET /v1/contacts` atual). `metadata` existe depois do P1-E1.

**Lead**
```json
{ "id": "uuid", "contact_id": "uuid", "pipeline_id": "uuid", "pipeline_name": "Funil principal",
  "stage_id": "uuid", "stage_name": "Qualificado", "priority": false, "metadata": {},
  "created_at": "ISO", "updated_at": "ISO",
  "contact": { "id": "uuid", "name": "João", "phone": "5531999998888", "email": null, "tags": [] } }
```

**Funil**
```json
{ "id": "uuid", "name": "Funil principal", "position": 0,
  "stages": [ { "id": "uuid", "name": "Novo", "color": "#6366f1", "position": 1 } ] }
```

**Conversa**
```json
{ "id": "uuid", "type": "individual", "remote_jid": "5531999998888@s.whatsapp.net",
  "phone": "5531999998888", "contact_id": "uuid", "state": "automation",
  "state_since": "ISO", "state_by": null, "updated_at": "ISO",
  "contact": { "id": "uuid", "name": "João" } }
```
`type`: `individual` ou `group` (JID termina em `@g.us`). Em grupo, `phone` e `contact` são `null`
e `state` é só informativo (grupos não pausam).

**Mensagem**
```json
{ "id": "uuid", "message_id": "3EB0...", "conversation_id": "uuid",
  "remote_jid": "5531999998888@s.whatsapp.net", "from_me": false, "sender": null,
  "type": "text", "content": "Oi", "media_url": null, "file_name": null,
  "timestamp": 1790800000, "status": "received" }
```
`sender`: `automation` \| `human` \| `null` (mensagem do cliente ou antiga). `timestamp` em segundos.
O FlowMate guarda só **7 dias** de mensagens; o mais antigo fica na Evolution e não sai por estas rotas.

**Usuário**
```json
{ "id": "uuid", "name": "Ana", "email": "ana@x.com", "role": "seller", "active": true }
```

**Nota**
```json
{ "id": "uuid", "contact_id": "uuid", "text": "Ligou e pediu proposta", "auto": true,
  "user_id": null, "created_at": "ISO" }
```

---

## Leitura

### `GET /v1/pipelines` (P1-L1)
Lista paginada de **Funil**, ordenada por `position`. Equivale a `GET /crm/v2/panel` da Helena.

### `GET /v1/leads` (P1-L2)
Filtros: `pipelineId`, `stageId`, `contactId`, `priority` (`true`/`false`), `createdAfter`,
`createdBefore`, `updatedAfter`, `updatedBefore`. Ordem: `created_at` desc. Lista de **Lead**.

### `GET /v1/leads/{id}` (P1-L3)
Um **Lead**, com `contact` completo (objeto **Contato**). 404 `lead_not_found`.

### `GET /v1/leads/{id}/notes` (P1-L11)
Lista paginada de **Nota** do contato do lead, `created_at` desc. (Notas são do contato.)

### `GET /v1/contacts` sem `phone`, `id` e `external_id` (P1-L4)
Filtros: `name` (contém, sem diferenciar caixa), `tag` (tem a tag), `createdAfter`,
`createdBefore`, `updatedAfter`, `updatedBefore`. Ordem: `created_at` desc. Lista de **Contato**.
Busca por telefone continua sendo `GET /v1/contacts?phone=` (rota antiga, devolve um contato só,
sem mudança). O mesmo vale para `id` e `external_id`.

### `GET /v1/users` (P1-L5)
Lista paginada de **Usuário** da empresa, por nome. Serve para descobrir ids (transferência futura).

### `GET /v1/conversations` (P1-L6)
Filtros: `state` (`automation`/`human`), `type` (`individual`/`group`), `contactId`,
`updatedAfter`, `updatedBefore`. Ordem: `updated_at` desc. Lista de **Conversa**.

### `GET /v1/conversations/{id}` (P1-L7)
Uma **Conversa** + `last_message` (objeto **Mensagem** ou `null`). 404 `conversation_not_found`.

### `GET /v1/conversations/{id}/messages` (P1-L8)
Lista paginada de **Mensagem**. Query `order`: `desc` (padrão, mais novas primeiro) ou `asc`.

### `GET /v1/messages/{messageId}` (P1-L9)
Uma **Mensagem**, buscada pelo `message_id` do WhatsApp (o que o `POST /v1/messages` devolve).
404 `message_not_found`.

### `GET /v1/webhook-events` (P1-L10)
```json
{ "items": [ { "event": "lead.moved", "description": "Lead mudou de etapa ou de funil" } ] }
```
Sem paginação (lista curta e fixa).

---

## Escrita

### `POST /v1/contacts` (P1-E2)
```json
{ "name": "João", "phone": "31999998888", "email": "j@x.com", "external_id": "site-8842",
  "tags": ["vip"], "fields": { "Convênio": "Unimed" }, "metadata": { "erp_id": "C-77" },
  "options": { "upsert": false } }
```
> **Compatibilidade:** hoje `POST /v1/contacts` já existe como apelido não documentado do
> `PATCH /v1/contacts` (atualiza um contato existente; se não acha, responde 404). O
> comportamento novo **preserva** isso: quando o contato existe, a rota faz exatamente o que faz
> hoje. Só o caso "não existe" muda (de 404 para criar).

- Procura existente por `contact_id`, `external_id` e depois telefone (mesma regra de hoje, últimos 8 dígitos).
- **Existe** (e `options.upsert` não é `false`) → executa o handler antigo sem mudança (atualiza
  nome, e-mail, tags, campos e, se vier, etapa) e acrescenta `created: false` na resposta.
  Evento `contact.updated` se algo mudou (além do `lead.moved` que já existe).
- **Existe** e `options.upsert: false` → `409 { error: 'contact_exists', contact_id }`, nada é alterado.
- **Não existe** → cria. `name` obrigatório nesse caso (`400 missing_name`). Resposta
  `201 { ok, created: true, contact_id, unknown_fields }` + evento `contact.created`.
- **Não cria lead** (para isso já existe `POST /v1/leads`).

### `POST /v1/contacts/{id}/tags` (P1-E3)
```json
{ "tags": ["vip", "retorno"], "operation": "InsertIfNotExists" }
```
`operation`: `InsertIfNotExists` (padrão), `DeleteIfExists`, `ReplaceAll` (mesmos nomes da Helena).
Resposta `200 { ok, contact_id, tags, added, removed }`. Evento `contact.tags_updated` se mudou algo.

### `PATCH /v1/leads/{id}` (P1-E4)
```json
{ "stage_id": "uuid", "stage_name": "Qualificado", "pipeline_name": "Funil principal",
  "priority": true, "metadata": { "origem": "google" } }
```
- Etapa por `stage_id` **ou** `stage_name` (+ `pipeline_name` opcional), mesma lógica do
  `resolveStage` atual; mudar de etapa de outro funil move o lead de funil.
- `metadata`: merge; chave com valor `null` é removida.
- Resposta: o **Lead** atualizado. Eventos: `lead.moved` (se a etapa mudou, payload igual ao de
  hoje) e `lead.updated` (sempre que algo mudou, com `changes: ["stage_id","priority",...]`).
- Campos personalizados **não** entram aqui: eles são do contato (`PATCH /v1/contacts`).

### `POST /v1/leads/{id}/notes` (P1-E5)
```json
{ "text": "Cliente pediu proposta por e-mail" }
```
Grava em `crm_notes` no contato do lead, `auto: true`. `201` com a **Nota**. Evento `note.created`.

### `PATCH /v1/conversations/{id}` (P1-E6)
```json
{ "state": "human" }
```
`state`: `automation` ou `human` (`400 invalid_state`). Conversa de grupo → `422 unsupported_for_group`.
Resposta: a **Conversa**. Evento `conversation.state_changed` (P1-W1) com `changed_by: "api"`.

### `POST /v1/conversations/{id}/messages` (P1-E7)
```json
{ "content": "Olá!", "media": { "url": "https://...", "type": "image", "mimeType": "image/jpeg", "fileName": "a.jpg" } }
```
Mesmas regras do `POST /v1/messages`: `sender = automation`, **409 `conversation_paused`** se a
conversa está em humano. Usa o `remote_jid` da conversa (funciona para grupo). JID que não seja
`@s.whatsapp.net` nem `@g.us` → `422 unsupported_jid`. Resposta `200 { ok, message_id, conversation_id }`.

---

## Eventos novos (payload de `data`)

Envelope igual ao de hoje: `{ event_id, event, data, company_id, timestamp }`, assinado.

| Evento | `data` |
| --- | --- |
| `contact.updated` | `{ contact_id, changes: [..], source: "api" }` |
| `contact.tags_updated` | `{ contact_id, tags, added, removed, source: "api" }` |
| `lead.updated` | `{ lead_id, contact_id, stage_id, pipeline_id, priority, changes: [..], source: "api" }` |
| `note.created` | `{ note_id, contact_id, lead_id, text, source: "api" }` |
| `conversation.state_changed` | `{ conversation_id, contact_id, remote_jid, state, previous_state, changed_by, user_id }` — `changed_by`: `user` (alguém da equipe pela tela: botão ou envio), `phone` (respondeu pelo celular), `api` |
| `whatsapp.connection` | `{ status: "connected" \| "disconnected", phone, instance }` |
