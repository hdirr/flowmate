# 20 — Contrato das rotas novas da `/v1` (Parte 1)

Base: `https://flowmate-ashy.vercel.app/v1`. Autenticação: `x-api-key: SUA_CHAVE` **ou**
`Authorization: Bearer SUA_CHAVE`. Tudo em JSON, UTF-8. Toda consulta é filtrada pela empresa da
chave; um id de outra empresa responde **404**, nunca 403 (não revelamos que existe).

Nomes de campo: os **objetos** seguem o banco (`snake_case`); os **parâmetros de paginação e
filtro** seguem a Helena (`pageNumber`, `pageSize`, `createdAfter`...). É de propósito.

## Regra de produto: etiquetas não travam nada (2026-10-13)
Etiquetas (tags de contato hoje; etiquetas de contato e de conversa depois do
`PLANO-ETIQUETAS.md`) são **só marcadores**. Nunca travam envio, recebimento, roteamento nem
atendimento. Quem trata etiqueta é a automação do cliente (n8n).
- **Até a virada do `PLANO-ETIQUETAS`:** a única trava é o **estado da conversa** (`human` →
  `409 conversation_paused` no envio automático).
- **Depois da virada:** a única trava é a opcional `block_api_send_on_human`, por empresa e
  desligada por padrão.

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
`fields` sai **por nome** do campo (como no `GET /v1/contacts` atual). `metadata` (P1-E1): objeto livre
da integração, `{}` quando vazio; sai nas rotas novas (`GET /v1/contacts` em lista e o contato do
`GET /v1/leads/{id}`), **não** na rota antiga `GET /v1/contacts?phone=|id=|external_id=`.

**Lead**
```json
{ "id": "uuid", "contact_id": "uuid", "pipeline_id": "uuid", "pipeline_name": "Funil principal",
  "stage_id": "uuid", "stage_name": "Qualificado", "value": 1500.5, "priority": false, "metadata": {},
  "created_at": "ISO", "updated_at": "ISO",
  "contact": { "id": "uuid", "name": "João", "phone": "5531999998888", "email": null, "tags": [] } }
```
`value`: valor do negócio (`crm_leads.value`, numeric), sempre **número** ou `null`, nunca texto.
`value` existe no banco, mas ainda não aparece nem é editado no app; hoje vem 0. A edição pela tela
e pela API entra na Parte 2, bloco 1.
`metadata` (P1-E1) sai no `GET /v1/leads` e no `GET /v1/leads/{id}`, `{}` quando vazio. `contact` é `null` quando o
contato do lead não existe mais. Na lista (`GET /v1/leads`) o `contact` é resumido (`id, name,
phone, email, tags`); no `GET /v1/leads/{id}` é o objeto **Contato** completo.

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

- **`phone`**: só os dígitos antes do `@` quando o JID termina em `@s.whatsapp.net`. Para `@lid`
  (identificador novo do WhatsApp, que **não é telefone**), grupo ou formato desconhecido:
  `phone: null`. `@lid` e formato desconhecido contam como `individual`.
- **`contact`**: vem só pelo `contact_id` da conversa (`{ id, name }`). Sem `contact_id`, ou com
  contato que não existe mais: `contact: null`. Hoje a maioria das conversas não tem
  `contact_id`.
- **`updated_at`** = **última mudança de estado** (automation ↔ human), **não** a última mensagem.
  A coluna não tem gatilho; só muda quando o estado muda. A lista ordena por `updated_at` desc,
  com nulos no fim e `id` como desempate.

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

**Etiqueta** (só com a chave `labels` ligada na empresa; ver "Etiquetas")
```json
{ "id": "uuid", "name": "Retorno", "color": "#ef4444", "kind": "user", "system_key": null,
  "created_at": "ISO", "updated_at": "ISO" }
```
`kind`: `user` (criada pela empresa) ou `system` ("Atendimento humano", `system_key: "human"`;
"Atendimento IA", `system_key: "ai"`). Dentro de Contato, Conversa e dos eventos a etiqueta sai
curta: `{ id, name, color, kind }`. Com a chave ligada, **Contato** (no `GET /v1/contacts` em lista) e **Conversa**
ganham `labels: [etiqueta curta]`; desligada, as respostas são as de sempre.

**Nota**
```json
{ "id": "uuid", "contact_id": "uuid", "text": "Ligou e pediu proposta", "auto": true,
  "user_id": null, "created_at": "ISO" }
```

### Telefone → número do WhatsApp (P1-E0)
Regra única (`api/_lib/phone.js`), usada pela API, pela tela, pelas automações e pelos grupos:
- começa com `+` → já tem o código do país; vale como veio (só os dígitos);
- 10 dígitos (fixo BR ou celular antigo sem o 9) → `55` + número;
- 11 dígitos com `9` na 3ª posição (celular BR) → `55` + número;
- qualquer outro caso → como veio (ex.: `14155550123`, EUA com o `1`; 12–13 dígitos já com `55`).

**Ambíguo:** 11 dígitos com `9` na 3ª posição que também sejam número válido de outro país (ex.:
Rússia `7 9xx…`) são tratados como **brasileiros**. Para número estrangeiro, mande com `+`.
O `0` de longa distância (`0` + DDD + número) **não** é removido: mande sem ele.
Antes da P1-E0, todo número de 10–11 dígitos ganhava `55`, e número que já começava com `55`
(inclusive DDD 55 sem o código do país) ficava como veio.

**Conversa gêmea (celular BR com e sem o 9º dígito):** o WhatsApp grava muitos JIDs sem o 9
(`55 31 9999-8888`); o FlowMate monta com ele. As duas conversas podem existir para o mesmo
celular. Regras:
- **Envio automático** (`POST /v1/messages`, `POST /v1/conversations/{id}/messages`, automações):
  se **qualquer uma** das duas estiver em `human` → `409 conversation_paused`, nada enviado.
- **`GET /v1/contacts?phone=|id=|external_id=` e `GET /v1/messages?phone=`:** procuram a conversa
  pelo número normalizado e pela gêmea; se uma estiver em `human`, é ela que aparece. O
  `GET /v1/messages` junta o histórico das duas. (Antes procuravam só os dígitos, sem `55`, e
  contato salvo sem `55` saía com `conversation: null` / histórico vazio.)
- **Devolver para automação** (tela e `PATCH /v1/conversations/{id}` com `automation`, P1-E0b)
  retoma também a gêmea que estiver em `human`, mesmo que ela tenha sido pausada por outro caminho
  (é o mesmo celular e a ordem é explícita). Cada conversa que muda gera o seu
  `conversation.state_changed`. O badge da tela mostra `human` se qualquer uma das duas estiver
  em `human`. Pausar (`human`) mexe só na conversa indicada (o envio já respeita a gêmea).
- **Estado desconhecido (P1-E0b):** se a leitura da conversa falhar, o FlowMate nunca grava
  `automation` por cima: o envio automático responde `409`; envio pela tela e grupo respondem
  `503 conversation_unavailable`; a mensagem recebida é gravada, mas não sai `message.received`;
  `GET /v1/contacts?phone=|id=|external_id=` e `GET /v1/messages?phone=` respondem
  `503 conversation_unavailable` (antes afirmavam `automation`); o badge da tela fica vazio.
- As duplicadas **não** são juntadas (Parte 2).

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
Lista paginada de **Nota** do contato do lead, `created_at` desc (mais recentes primeiro; empate
por `id` desc). (Notas são do contato: o mesmo contato com dois leads mostra as mesmas notas nos
dois.)
- Lead existente sem notas, ou sem contato → `200` com `items: []`.
- Lead inexistente, de outra empresa ou id que não é UUID → `404 lead_not_found`.
- `user_id` é o autor quando a nota foi escrita na tela ou pela API com `user_id` (`auto: false`);
  `null` quando veio de automação ou da API sem autor (`auto: true`). Só o id do usuário: para o
  nome, use `GET /v1/users`.

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
Uma **Conversa** + `last_message` (objeto **Mensagem** ou `null`). 404 `conversation_not_found`
(id que não é UUID, inexistente ou de outra empresa).

`last_message` é a mensagem mais recente com o mesmo `remote_jid` da conversa (ordem `timestamp`
desc, depois `id`). Como o FlowMate guarda só **7 dias** de mensagens, **`last_message: null` é
comum** em conversa parada há mais de uma semana. Não significa que a conversa não tem
mensagens: as antigas ficam só na Evolution.

### `GET /v1/conversations/{id}/messages` (P1-L8)
Lista paginada de **Mensagem**. Query `order`: `desc` (padrão, mais novas primeiro) ou `asc`;
outro valor → `400 invalid_filter`. Ordem por `timestamp` e, no empate, `id` (mesma direção).
Mensagens com o mesmo `remote_jid` da conversa. Só há **7 dias** de mensagens: conversa parada há
mais tempo devolve `items: []`. Conversa que não existe (ou id que não é UUID) →
`404 conversation_not_found`.

### `GET /v1/messages/{messageId}` (P1-L9)
Uma **Mensagem**, buscada pelo `message_id` do WhatsApp (o que o `POST /v1/messages` devolve).
404 `message_not_found`.

- O `message_id` **não é UUID**: é alfanumérico (hoje, hex maiúsculo de 20, 22 ou 32
  caracteres). A rota aceita letras, dígitos, `_` e `-`, até **128** caracteres. Fora desse
  formato → 404 `message_not_found`, sem consulta.
- A comparação é **exata e diferencia maiúsculas** (`ac89…` ≠ `AC89…`).
- Só mensagens da empresa da chave; o id de outra empresa responde 404.
- Só há **7 dias** de mensagens: um `message_id` antigo dá 404 mesmo que a mensagem exista na
  Evolution.
- Se houver mais de uma linha com o mesmo `message_id` na empresa, sai a mais recente
  (`timestamp` desc, `id` desc).
- `GET /v1/messages?phone=` (histórico por telefone) e `POST /v1/messages` são as rotas antigas e
  não mudam.

### `GET /v1/webhook-events` (P1-L10)
```json
{ "items": [
  { "event": "lead.moved", "description": "Lead mudou de etapa ou de funil", "since": "v1",
    "available": true, "available_after": null },
  { "event": "conversation.state_changed", "description": "Conversa mudou entre automação e humano",
    "since": "p1", "available": false, "available_after": "P1-W1" } ] }
```
- **Paginação:** nenhuma (lista curta e fixa); `pageSize`/`pageNumber` são ignorados.
- **Status de cada evento:**
  - `available: true` = o evento já é emitido hoje;
  - `available: false` = ainda não sai, e `available_after` diz a etapa de que ele depende.

  Assinar um evento com `available: false` não dá erro, mas nada chega até a etapa sair.
- **Fonte:** o catálogo `api/_lib/events.js`.
- **`requires_feature`** (desde as etiquetas): chave da empresa sem a qual o evento nunca sai
  (`"labels"` nos eventos de etiqueta; `null` nos demais). A tela de Integrações só mostra esses
  eventos para a empresa com a chave ligada.
- **É o catálogo, não a assinatura da empresa.** A assinatura é feita em Configurações →
  Integrações. Com **nenhum** evento marcado, a empresa recebe **todos**, inclusive os que
  passarem a existir depois.

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
- **Implementado na P1-E2:**
  - **Procura:** a mesma do handler antigo. Com `contact_id`, só por ele; senão, com
    `external_id`, só por ele (o telefone **não** é usado); senão, pelo telefone (últimos 8
    dígitos). `contact_id` que não existe (ou não é UUID) → `404 contact_not_found`, como antes.
  - **Existe:** resposta do handler antigo + `created: false` (`200 { ok, contact_id, moved,
    unknown_fields, created }`). Erros do handler antigo saem como sempre (ex.: `400
    stage_not_found`, que pode vir depois de ele já ter gravado nome/e-mail/tags/campos).
    `metadata` faz merge (`null` remove a chave), só quando o handler antigo respondeu 200.
    `contact.updated` `{ contact_id, changes, source: "api" }` quando algo mudou de fato no banco
    (`changes` entre `name`, `email`, `tags`, `fields`, `metadata`); o `PATCH /v1/contacts` antigo
    **não** gera esse evento.
  - **Cria:** `name` (texto não vazio) → senão `400 missing_name`. Opcionais: `phone` (gravado
    como veio), `email`, `external_id`, `tags` (até 50 textos de até 100 caracteres, sem
    duplicatas → senão `400 invalid_tags`), `fields` (por id ou nome; desconhecidos voltam em
    `unknown_fields`), `metadata`. `stage_id`/`stage_name`/`pipeline_name` → `400 invalid_field`
    (contato novo não recebe etapa; use `POST /v1/leads`). `created_by` nulo.
    `contact.created` `{ contact_id, name, phone, email, source: "api" }`.
  - **Outros erros:** `400 invalid_body` (corpo não é objeto), `400 invalid_field` (`options`,
    `options.upsert` não booleano, `metadata` fora de objeto), `400 metadata_too_large`,
    `409 contact_exists` (com `contact_id`). Se a empresa já tiver **mais de um** contato com o
    mesmo `external_id` (o banco não impede), a rota não cria outro: `409 contact_exists` com
    `contact_id: null` (use `contact_id`).
  - **Mudança registrada:** `POST` sem `contact_id`, `external_id` e `phone`, só com `name`, antes
    respondia 404; agora cria.
  - **Automação "contato criado" da tela não dispara pela API** (limitação conhecida).

### `POST /v1/contacts/{id}/tags` (P1-E3)
> **Mudança com a chave `labels` ligada (2026-10-19):** as tags são gravadas **padronizadas**
> (o slug das etiquetas): `"VIP"` grava `"vip"`, `"Promoção Natal"` grava `"promocao-natal"`;
> repetidas depois de padronizar viram uma; `DeleteIfExists` com `"VIP"` remove `"vip"`; tag
> vazia depois de padronizar → `400 invalid_tags`. `tags`/`added`/`removed` da resposta e do
> evento saem padronizados. Vale também para `tags` no `POST /v1/contacts`. Com a chave
> desligada, nada muda (exata, como abaixo). Ainda gravam como vier: `PATCH /v1/contacts`
> antigo, `POST /v1/leads` e automações/importação da tela (a etiqueta criada pelo gatilho fica
> com esse nome; o `supabase_labels_slug.sql` normaliza o que já existe).

```json
{ "tags": ["vip", "retorno"], "operation": "InsertIfNotExists" }
```
`operation`: `InsertIfNotExists` (padrão), `DeleteIfExists`, `ReplaceAll` (mesmos nomes da Helena).
Resposta `200 { ok, contact_id, tags, added, removed }`. Evento `contact.tags_updated` se mudou algo.
- **Implementado na P1-E3:**
  - **`tags`:** lista de 1 a 50 textos, até 100 caracteres cada. Espaços das pontas são
    removidos e duplicatas da entrada são ignoradas. Lista vazia só com `ReplaceAll` (limpa
    todas).
  - **Comparação exata, que diferencia maiúsculas**, como o filtro `tag` do `GET /v1/contacts`.
  - **Ordem:** a das tags atuais é mantida; as novas entram no fim.
  - **Nada mudou** → 200 com `added: []` e `removed: []`, sem evento.
  - **Erros:**
    - 400 `invalid_tags` / `invalid_operation` / `invalid_body`;
    - 404 `contact_not_found` (inexistente, de outra empresa, id que não é UUID).
  - **Evento:** `contact.tags_updated` `{ contact_id, tags, added, removed, source: "api" }`.
  - **A automação "tag adicionada" da tela não dispara pela API** (limitação conhecida).

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
- **`metadata` (P1-E1):** objeto; merge com o atual — chave com `null` é removida, as outras são
  sobrescritas, as não enviadas ficam. Até 50 chaves e 16 KB depois do merge
  (`400 metadata_too_large`); fora de objeto → `400 invalid_field`. Sem mudança efetiva não entra em
  `changes`. O `lead.updated` sai com `changes: ["metadata"]` (o valor não vai no evento).
- **Implementado na P1-E4:**
  - **Campos aceitos:** `stage_id` | `stage_name` (+ `pipeline_name` opcional), `priority`
    (`true`/`false`) e `value` (número ≥ 0, ou `null`). Campos desconhecidos são ignorados.
  - **Etapa:** procurada só nos funis da empresa. Nome sem diferenciar caixa e sem curinga. Se o
    nome existir em vários funis e não vier `pipeline_name`, vale o funil atual do lead.
  - **Erros (400):**
    - `priority` ou `value` inválidos → `invalid_field`;
    - `pipeline_name` sem `stage_name` → `invalid_field`;
    - nenhum campo aceito → `empty_update`;
    - etapa não achada → `stage_not_found`;
    - corpo que não é objeto → `invalid_body`.
  - **404 `lead_not_found`:** lead inexistente, de outra empresa ou id que não é UUID.
  - **Resposta:** o **Lead** como no `GET /v1/leads/{id}` (contato completo).
  - **Sem mudança efetiva:** 200, sem evento.
  - **Eventos:**
    - `lead.moved` `{ contact_id, lead_id, stage_id, pipeline_id, source: "api" }`, quando a
      etapa muda;
    - `lead.updated` `{ lead_id, contact_id, stage_id, pipeline_id, priority, value, changes,
      source: "api" }`, quando algo muda.
  - **Automações da tela não disparam** para alterações feitas pela API (limitação conhecida).

### `POST /v1/leads/{id}/notes` (P1-E5)
```json
{ "text": "Cliente pediu proposta por e-mail" }
```
Grava em `crm_notes` no contato do lead. `201` com a **Nota**. Evento `note.created`.
`auto: false` quando vem com `user_id` (nota atribuída a um usuário); sem `user_id`, `auto: true`.
- **Implementado na P1-E5:**
  - **`text`:** obrigatório, até 8000 caracteres → `400 missing_text` / `text_too_long`.
  - **`user_id` opcional:** o autor; precisa ser um usuário da empresa (`GET /v1/users`), senão
    `400 invalid_field`. Sem ele, a nota fica sem autor (`user_id: null`).
  - **Erros:**
    - `404 lead_not_found` (inexistente, de outra empresa, id que não é UUID);
    - `422 lead_without_contact` (lead sem contato).
  - **Evento:** `note.created` `{ note_id, contact_id, lead_id, text, source: "api" }`.
  - A nota aparece no `GET /v1/leads/{id}/notes` de todos os leads do mesmo contato.

### `PATCH /v1/conversations/{id}` (P1-E6)
```json
{ "state": "human" }
```
`state`: `automation` ou `human` (`400 invalid_state`). Conversa de grupo → `422 unsupported_for_group`.
Resposta: a **Conversa**. Evento `conversation.state_changed` (P1-W1) com `changed_by: "api"`.
- **Implementado na P1-E6:**
  - **Resposta:** a Conversa no formato do `GET /v1/conversations/{id}`, sem `last_message`.
  - **Mesmo estado que já está** → 200, sem mudança (`state_since` não muda).
  - **Pela API, `state_by` fica `null`**, igual a quando o dono responde pelo celular. Ainda não
    há como distinguir; o `changed_by` do evento resolve isso na P1-W1.
  - **Evento (desde a P1-W1):** `conversation.state_changed` com `changed_by: "api"`, só quando
    o estado muda de fato.
  - **Erros:**
    - 400 `invalid_state` / `invalid_body`;
    - 404 `conversation_not_found` (inexistente, de outra empresa, id que não é UUID);
    - 422 `unsupported_for_group`.
  - **Efeito:** em `human`, o `message.received` deixa de ir para o n8n e o `POST /v1/messages`
    responde 409 `conversation_paused`; volta ao passar para `automation`.
  - **Gêmea (P1-E0b):** `automation` retoma também a conversa gêmea (mesmo celular com/sem o 9º
    dígito) que estiver em `human`, mesmo que esta conversa já esteja em `automation`; um
    `conversation.state_changed` por conversa que mudou. A resposta é só a conversa pedida.

### `POST /v1/conversations/{id}/messages` (P1-E7)
```json
{ "content": "Olá!", "media": { "url": "https://...", "type": "image", "mimeType": "image/jpeg", "fileName": "a.jpg" } }
```
Mesmas regras do `POST /v1/messages`: `sender = automation`, **409 `conversation_paused`** se a
conversa está em humano. Usa o `remote_jid` da conversa (funciona para grupo). JID que não seja
`@s.whatsapp.net` nem `@g.us` → `422 unsupported_jid`. Resposta `200 { ok, message_id, conversation_id }`.
- **Implementado na P1-E7:**
  - **`unsupported_jid` (422):** `@lid` e qualquer JID individual que não seja só dígitos
    `@s.whatsapp.net`. Desde a P1-E0 o número da conversa vai exatamente como está no JID (com
    `+`), então conversa com número estrangeiro é aceita e vai para o número certo (antes, os de
    10–11 dígitos eram recusados com 422).
  - **Pausa:** checada na própria rota antes do envio → `409 { error: "conversation_paused",
    message, conversation_id }`.
  - **Grupos não pausam:** o envio para grupo acontece mesmo com `state: human`.
  - **Erros:**
    - `400 missing_content` / `invalid_field` (`media` sem `url`) / `invalid_body`;
    - `404 conversation_not_found`;
    - `502` vindo da Evolution (`delivery_failed` ou a mensagem dela).
  - **Evento:** o mesmo `message.sent` do `POST /v1/messages` (`sender: "automation"`).

### Fila de envio (CF-A · A6) — só com a chave `send_queue` ligada na empresa
Vale para `POST /v1/messages` e `POST /v1/conversations/{id}/messages`. Com a fila desligada, as
respostas são as de sempre, sem os campos abaixo.
- **Header `Idempotency-Key`** (opcional):
  - 1 a 128 caracteres visíveis; senão `400 invalid_field` (só com a fila ligada; desligada, o
    header é ignorado, como sempre foi);
  - a mesma chave na mesma empresa devolve o resultado do primeiro envio (`duplicate: true`) e
    **não envia de novo**, mesmo que a conversa tenha sido pausada depois.
- **Respostas:**
  - `200 { ok, message_id, conversation_id, outbound_id, delivery: "sent" }`: entregue à Evolution.
  - **`202 { ok, message_id: null, conversation_id, outbound_id, delivery: "pending" }`**: a
    Evolution estava fora, com certeza de que não recebeu o pedido. O FlowMate tenta de novo:
    - esperas de 15 s, 30 s, 60 s e 120 s, até 5 tentativas;
    - confere a pausa antes de cada tentativa;
    - **desiste depois de 10 min** (`dead`).
  - `502 { error, conversation_id, outbound_id, delivery: "failed" }`: recusada ou **ambígua**
    (tempo esgotado, erro 5xx: pode ter saído). **Não é reenviada**, para nunca duplicar.
  - `503 queue_unavailable`: não deu para registrar o envio; nada foi enviado.
  - Repetição com a mesma chave de um envio **ainda em andamento** → `202` com
    `delivery: "sending"`.
- **`GET /v1/outbound-messages/{id}`:**
  - resposta: `{ id, status, attempts, last_error, message_id, conversation_id, remote_jid,
    sender, created_at, sent_at }`;
  - `status`: `sending` | `sent` | `pending` | `failed` | `dead`;
  - outra empresa ou id que não é UUID → `404 outbound_not_found`.
- O eco do envio (`fromMe`) casa com a fila e não pausa a conversa por engano.

### Etiquetas (PLANO-ETIQUETAS · ET-2) — só com a chave `labels` ligada na empresa
Chave desligada → todas as rotas abaixo respondem **`404 feature_off`** e as demais respostas
não mudam. Etiqueta é **só marcador**: não trava envio, recebimento nem atendimento (a única trava
continua sendo o estado da conversa, `409 conversation_paused`).

| Rota | O que faz |
| --- | --- |
| `GET /v1/labels` | Lista paginada (sistema primeiro, depois por nome). Filtro `kind=user|system` (outro → `400 invalid_filter`) |
| `GET /v1/labels/{id}` | Uma **Etiqueta** |
| `POST /v1/labels` | `{ name, color? }` → `201` Etiqueta (`kind: user`) |
| `PATCH /v1/labels/{id}` | `{ name?, color? }` → `200` Etiqueta + `changes: ["name","color"]` |
| `DELETE /v1/labels/{id}` | `200 { ok, id, name, contacts_removed, conversations_removed }` |
| `POST /v1/contacts/{id}/labels` | `{ labels: [id ou nome], operation }` → `200 { ok, contact_id, labels, added, removed, tags }` |
| `POST /v1/conversations/{id}/labels` | mesmo corpo → `200` **Conversa** (com `labels`) + `added`, `removed` |

- **Nome padronizado (slug, desde 2026-10-19)** em toda criação e edição: minúsculas, sem
  acento, qualquer caractere fora de `a-z`/`0-9` vira hífen, sem hífen repetido nem nas pontas
  ("Promoção Natal" → `promocao-natal`; "VIP" → `vip`). A resposta traz o nome final.
  - Vazio depois de padronizar (ex.: "!!!") ou mais de 100 caracteres → `400 invalid_name`.
  - Slug que já existe → `409 label_exists` com `label_id` e `name` da existente (use-a).
  - As de **sistema** mantêm o nome ("Atendimento humano", "Atendimento IA"); uma de usuário
    `atendimento-ia` é outra etiqueta e não conflita.
  - Ao aplicar por nome, vale o nome exato **ou** o slug do que você mandar ("Promoção Natal"
    acha `promocao-natal`).
- **Cor:** só a paleta (8 cores + cinza padrão `#64748b`): `#64748b`, `#ef4444`, `#f97316`,
  `#f59e0b`, `#22c55e`, `#14b8a6`, `#3b82f6`, `#6366f1`, `#ec4899` (sem diferenciar caixa;
  grava em minúsculas). Fora dela → `400 invalid_color`. Sem `color` → cinza.
- **Etiquetas de sistema** ("Atendimento humano"/"Atendimento IA"): **só a cor muda**. Renomear
  (nome diferente do atual) ou excluir → `422 label_is_system`. As automações e a pausa da
  conversa dependem delas.
- **Renomear/excluir** etiqueta de usuário atualiza também o array `tags` dos contatos (numa
  transação). Excluir tira a etiqueta de todos os contatos e conversas; a resposta diz quantos.
- **Aplicar/remover** (`operation`: `InsertIfNotExists` (padrão), `DeleteIfExists`,
  `ReplaceAll` — os nomes da E3): `labels` com 1 a 50 ids ou nomes exatos; vazia só com
  `ReplaceAll`. Id/nome que não existe na empresa → `422 label_not_found` com `missing: [...]`
  (crie antes com `POST /v1/labels`; aqui nada é criado).
  - **Contato:** só etiquetas de usuário (sistema → `422 label_is_system`). O array `tags`
    continua sendo a fonte e fica **espelhado**: aplicar/remover escreve no array, e a E3
    (`POST /v1/contacts/{id}/tags`, com nomes) continua igual — tag nova vira etiqueta (cinza).
    Sai `contact.tags_updated` (como na E3) **e** `contact.labels_updated`.
  - **Conversa:** etiquetas de usuário em qualquer conversa (inclusive grupo). Sistema:
    - só em conversa **individual** → grupo `422 unsupported_for_group`;
    - **exclusivas**: aplicar uma tira a outra; as duas na mesma chamada → `422
      system_labels_exclusive`;
    - **não se remove** (`DeleteIfExists` com uma delas → `422 system_label_required`: aplique a
      outra); `ReplaceAll` sem nenhuma de sistema mantém a atual;
    - aplicar uma = mudar o estado: "Atendimento humano" → `state: human` (pausa, `409` no envio
      automático, como o `PATCH` com `state`); "Atendimento IA" → `automation`. Vale também
      para a **gêmea** (mesmo celular com/sem o 9º dígito). Sai também `conversation.state_changed`.
  - Nada mudou → `200` com `added: []`, `removed: []`, sem evento.
- **`labels` nas respostas** (chave ligada): `GET /v1/contacts` (lista), `GET /v1/conversations`,
  `GET /v1/conversations/{id}`, `PATCH /v1/conversations/{id}`. A rota antiga
  `GET /v1/contacts?phone=|id=|external_id=` não muda (regra da Parte 1).
- **`PATCH /v1/conversations/{id}` com `state`** continua aceito; a etiqueta de sistema acompanha
  (o banco troca junto).
- **Erros:** `400 invalid_body` / `invalid_name` / `invalid_color` / `invalid_labels` /
  `invalid_operation`; `404 feature_off` / `label_not_found` / `contact_not_found` /
  `conversation_not_found` (outra empresa ou id que não é UUID); `409 label_exists`; `422` acima.
  Método errado em rota de etiqueta → `405` (antes de conferir a chave).
- **Automações da tela** ("tag adicionada") não disparam por etiqueta aplicada pela API
  (limitação conhecida da Parte 1).

---

## Eventos novos (payload de `data`)

Envelope igual ao de hoje: `{ event_id, event, data, company_id, timestamp }`, assinado.

| Evento | `data` |
| --- | --- |
| `contact.updated` | `{ contact_id, changes: [..], source: "api" }` |
| `contact.tags_updated` | `{ contact_id, tags, added, removed, source: "api" }` |
| `lead.updated` | `{ lead_id, contact_id, stage_id, pipeline_id, priority, changes: [..], source: "api" }` |
| `note.created` | `{ note_id, contact_id, lead_id, text, source: "api" }` |
| `conversation.state_changed` | `{ conversation_id, contact_id, remote_jid, state, previous_state, changed_by, user_id }` — `changed_by`: `user` (alguém da equipe pela tela: botão ou envio), `phone` (respondeu pelo celular), `api`. `user_id`: quem pausou pela tela (envio ou botão "pausar"); `null` ao devolver para automação pelo botão, pelo celular e pela API. Só sai quando o estado muda de fato; grupos não geram o evento. (P1-W1) |
| `label.created` | `{ label, source, user_id }` — `label` = Etiqueta completa. Só com a chave `labels` (vale para os 5 eventos de etiqueta). |
| `label.updated` | `{ label, changes: ["name","color"], previous: { name, color }, source, user_id }` |
| `label.deleted` | `{ label, contacts_removed, conversations_removed, source, user_id }` (não sai um `*.labels_updated` por contato/conversa) |
| `contact.labels_updated` | `{ contact_id, labels, added, removed, source, user_id }` (etiquetas curtas). Sai pela tela, `POST /v1/contacts/{id}/labels`, E3 (`/tags`) e `POST /v1/contacts` com `tags`. **Não** sai pelo `PATCH /v1/contacts` antigo, `POST /v1/leads` nem pelas automações do navegador. |
| `conversation.labels_updated` | `{ conversation_id, contact_id, remote_jid, labels, added, removed, source, user_id }` — `source`: `user` (tela: etiqueta, envio, botão "devolver"), `api`, `phone` (respondeu pelo celular → Atendimento humano), `system` (conversa nova → Atendimento IA). Junto com o `conversation.state_changed` quando a etiqueta de sistema muda. |
| `whatsapp.connection` | `{ status: "connected" \| "disconnected", phone, instance }` |
