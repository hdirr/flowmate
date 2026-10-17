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
- **Telefone:** número **estrangeiro, mande sempre com `+` e o código do país**
  (`+14155550123`). Sem `+`, 10 dígitos e celular de 11 dígitos com `9` na 3ª posição ganham `55`
  (Brasil); o resto vai como veio. **Ambíguo:** um número estrangeiro de 11 dígitos com `9` na 3ª
  posição sem `+` (ex.: Rússia `7 9xx…`) é tratado como brasileiro.
- **Mudanças de 2026-10-02 (P1-E0):**
  - `GET /messages?phone=` e `GET /contacts?phone=` passam a achar a **conversa real** mesmo com
    o telefone salvo sem `55` ou sem o 9º dígito. Podem vir **`state: "human"`** e **histórico**
    onde antes vinha `automation` e lista vazia.
  - Número estrangeiro passa a ir para o **número certo** (antes, um de 10–11 dígitos ganhava `55`
    e ia para um número brasileiro). O `POST /conversations/{id}/messages` passa a aceitar
    conversa com número estrangeiro (antes 422).
  - **409 mais seguro:** o mesmo celular pode ter duas conversas (com e sem o 9º dígito). Se
    qualquer uma estiver em `human`, o envio automático leva 409. `PATCH /conversations/{id}`
    com `{ "state": "automation" }` retoma as duas (um `conversation.state_changed` para cada
    uma que mudou).
  - **503 `conversation_unavailable`:** se o FlowMate não conseguir ler o estado da conversa,
    `GET /messages?phone=` e `GET /contacts?phone=` respondem 503 (antes diziam `automation`).
    Trate como "não sei o estado": **não responda** o cliente e tente de novo depois.

## 4. Rotas disponíveis

### Leitura
| Rota | O que devolve | Filtros e observações |
| --- | --- | --- |
| `GET /pipelines` | Funis com etapas, na ordem da tela | — |
| `GET /leads` | Leads paginados, mais novos primeiro | `pipelineId`, `stageId`, `contactId`, `priority`, `createdAfter/Before`, `updatedAfter/Before` |
| `GET /leads/{id}` | Um lead com o contato completo (`fields` por nome) | `value` hoje vem 0 (o app ainda não edita) |
| `GET /leads/{id}/notes` | Notas do contato do lead, mais novas primeiro | `user_id` nulo = nota de automação ou da API sem autor |
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
| `POST /contacts` | `{ "name": "…", "phone": "…", "external_id": "seu-id", "tags": […], "fields": {…}, "metadata": {…} }` | cria contato **sem lead** (201, `created: true`); se já existe (por `contact_id`, senão `external_id`, senão telefone) atualiza como o `PATCH /contacts` e devolve `created: false`; `"options": { "upsert": false }` → 409 `contact_exists` |
| `POST /notes` | `{ "phone": "…", "text": "…" }` | nota interna no contato |
| `PATCH /leads/{id}` | `{ "stage_name": "Negociação", "pipeline_name": "Funil principal", "priority": true, "value": 1500 }` | move de etapa e funil; `metadata` faz merge (`null` remove a chave; até 50 chaves / 16 KB) |
| `POST /leads/{id}/notes` | `{ "text": "Cliente pediu proposta", "user_id": "<USER_ID>" }` | nota no contato do lead; `user_id` (autor) opcional, de `GET /users`; com autor sai `auto: false`, sem autor `auto: true`; 201 com a nota |
| `POST /contacts/{id}/tags` | `{ "tags": ["vip"], "operation": "InsertIfNotExists" }` | também `DeleteIfExists` e `ReplaceAll`. **Tags diferenciam maiúsculas: `VIP` e `vip` são tags diferentes** |
| `PATCH /conversations/{id}` | `{ "state": "human" }` ou `{ "state": "automation" }` | grupo → 422; gera `conversation.state_changed` (`changed_by: "api"`) |
| `POST /conversations/{id}/messages` | `{ "content": "Olá!" }` (+ `media` opcional) | envia pela conversa (serve para grupo); **409** se a conversa estiver em `human`; `@lid` → 422 `unsupported_jid` |

Exemplo curto (n8n → nó HTTP Request ou `curl`):
```bash
curl -X PATCH "https://flowmate-ashy.vercel.app/v1/leads/<LEAD_ID>" \
  -H "x-api-key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{ "stage_name": "Negociação" }'
```

**`metadata`:** objeto livre seu (id no seu sistema, origem…). Sai em contatos e leads das rotas
novas (`{}` quando vazio); grava pelo `PATCH /leads/{id}` e pelo `POST /contacts`.

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
| `contact.created` | Contato criado na tela ou pelo `POST /contacts` (`source: "api"`) |
| `contact.updated` | Contato existente alterado pelo `POST /contacts`, com `changes` (o `PATCH /contacts` antigo não gera) |
| `lead.created` | Lead criado (tela ou `POST /leads`) |
| `lead.moved` | Lead mudou de etapa ou de funil |
| `lead.updated` | Lead alterado pela API (`PATCH /leads/{id}`), com `changes` |
| `contact.tags_updated` | Tags alteradas pela API (`POST /contacts/{id}/tags`), com `added`/`removed` |
| `note.created` | Nota criada pela API (`POST /leads/{id}/notes`) |
| `conversation.state_changed` | Conversa mudou entre `automation` e `human`; `changed_by`: `user` (tela), `phone` (respondeu pelo celular) ou `api`; `previous_state` e `user_id` |

**Ainda não sai** (`available: false`): `whatsapp.connection`. Assinar não
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

## 5b. Fila de envio (quando for ligada na sua empresa; você será avisado)
- **Mande o header `Idempotency-Key`** (ex.: o id da execução do n8n + o da mensagem). Se o n8n
  repetir a chamada, o FlowMate devolve o resultado da primeira e **não envia de novo**.
- **202 `delivery: "pending"`:** aceito, ainda não entregue (o WhatsApp estava fora). O FlowMate
  tenta de novo por até 10 min. **Não reenvie.** Acompanhe em
  `GET /outbound-messages/{outbound_id}`.
- **502 `delivery: "failed"`:** não saiu, ou não dá para saber se saiu. Não é reenviada
  automaticamente.

## 5c. Etiquetas (quando a chave `labels` for ligada na sua empresa; você será avisado)
Desligada, as rotas abaixo respondem **404 `feature_off`** e nada mais muda. Ligada:
- **Etiquetas são só marcadores.** Ligar a chave **não** tira o 409: a trava continua sendo o
  estado da conversa ("Atendimento humano" = `state: human`). Ver 6b.
- **Rotas:**

  | Rota | Corpo | Observações |
  | --- | --- | --- |
  | `GET /labels` | — | lista paginada; `?kind=user` ou `system` |
  | `POST /labels` | `{ "name": "Retorno", "color": "#ef4444" }` | 201; nome repetido → 409 `label_exists`; cor só da paleta (abaixo) |
  | `PATCH /labels/{id}` | `{ "name": "…", "color": "…" }` | de sistema: só a cor (nome → 422 `label_is_system`) |
  | `DELETE /labels/{id}` | — | tira de todos os contatos/conversas; diz quantos. Sistema → 422 |
  | `POST /contacts/{id}/labels` | `{ "labels": ["Retorno"], "operation": "InsertIfNotExists" }` | id ou nome exato; `DeleteIfExists`, `ReplaceAll`. Sistema → 422. Nome que não existe → 422 `label_not_found` + `missing` |
  | `POST /conversations/{id}/labels` | mesmo corpo | grupo aceita só etiquetas de usuário |
- **Cores (paleta):** `#64748b` (cinza, padrão), `#ef4444`, `#f97316`, `#f59e0b`, `#22c55e`,
  `#14b8a6`, `#3b82f6`, `#6366f1`, `#ec4899`. Outra → 400 `invalid_color`.
- **"Atendimento humano" e "Atendimento IA"** (sistema): sempre uma das duas em toda conversa
  individual; nunca em contato nem em grupo; não se removem — **aplique a outra** (remover → 422
  `system_label_required`). Aplicar "Atendimento humano" = pausar (`state: human`, 409 no envio
  automático); "Atendimento IA" = devolver. Vale também para a gêmea (com/sem o 9º dígito).
- **Tags continuam:** `POST /contacts/{id}/tags` funciona igual; etiqueta de contato e tag são a
  mesma coisa (tag nova vira etiqueta cinza; renomear/excluir a etiqueta muda as `tags`).
- **`labels`** passa a vir em `GET /contacts` (lista) e nas conversas (`GET /conversations`,
  `GET/PATCH /conversations/{id}`), no formato `[{ id, name, color, kind }]`.
- **Eventos** (só com a chave; na tela de Integrações aparecem só com ela ligada):

  | `event` | Quando |
  | --- | --- |
  | `label.created` / `label.updated` / `label.deleted` | etiqueta criada, renomeada/recolorida (`changes`, `previous`), excluída (`contacts_removed`, `conversations_removed`) |
  | `contact.labels_updated` | etiquetas do contato mudaram (`labels`, `added`, `removed`) — tela, API e `/tags` |
  | `conversation.labels_updated` | etiquetas da conversa mudaram — `source`: `user` (tela), `api`, `phone` (respondeu pelo celular), `system` (conversa nova → "Atendimento IA") |

  Todos trazem `source` e `user_id` (quem fez na tela; `null` pela API). O
  `conversation.state_changed` e o `contact.tags_updated` continuam saindo junto.

## 6. Regras de ouro
1. **409 `conversation_paused` é esperado:** um humano assumiu a conversa. Não reenvie.
2. **Deduplique por `event_id`.** O mesmo evento pode chegar duas vezes.
3. **Não reaja aos próprios envios:** o `message.sent` com `sender: "automation"` é seu.
4. **Conversa em `human` não gera `message.received`** e **não volta sozinha** para
   `automation`. Retome com `PATCH /conversations/{id}` `{ "state": "automation" }` ou pela tela.
   Assine `conversation.state_changed` para saber quando um humano assume ou devolve.
5. **Idempotência de lead:** use sempre o mesmo `external_id`.
6. **Sem limite de requisições ainda, mas seja gentil:** no máximo algumas por segundo.

## 6b. Mudança anunciada: a trava vira etiqueta (ainda NÃO ativa)
O FlowMate vai deixar de **travar** o envio em conversa com atendente e passar a só **marcar** a
conversa com etiquetas, como a Helena: **"Atendimento humano"** ou **"Atendimento IA"** (sempre
uma das duas). Quem decide se responde passa a ser **o seu fluxo do n8n**.

- **Hoje nada mudou:** continua valendo o 409 `conversation_paused` e as regras acima. A gestão de
  etiquetas (5c) **não** muda isso: com ela, a conversa já traz `labels` e "Atendimento humano"
  equivale a `state: human`, mas o 409 continua.
- **Quando a virada da trava for ligada na sua empresa** (etapa seguinte; você será avisado antes):
  - o envio pela API **não é mais recusado** por causa da etiqueta. Existe uma opção por empresa
    para manter o bloqueio, desligada por padrão;
  - a conversa passa a trazer `labels` (e continua trazendo `state`, derivado da etiqueta);
  - saem os eventos `conversation.labels_updated` e `contact.labels_updated`. O
    `conversation.state_changed` continua por um tempo.
- **Padrão recomendado, já a partir de hoje:** **antes de responder, confira se a conversa está
  com atendente.**
  1. `GET /conversations/{id}` (o `conversation_id` vem no `message.received`).
  2. Não responda se:
     - **hoje:** `state` for `"human"`;
     - **depois da mudança:** `labels` tiver **"Atendimento humano"**.
  3. Trate **503** como "não sei": não responda e tente de novo depois.

  Quem já faz essa checagem não precisa mudar nada quando a etiqueta for ligada.
- O desenho completo está em `docs/roadmap-api/PLANO-ETIQUETAS.md`.

## 7. Como reportar problemas
Mande ao Agadir:
- a rota;
- o horário (UTC);
- o status e o corpo da resposta, **sem a chave**;
- o `event_id` (se for webhook).

Não mande prints com a chave ou o segredo.
