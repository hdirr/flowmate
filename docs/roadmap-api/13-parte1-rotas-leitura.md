# 13 — Parte 1: rotas de leitura (P1-L*)

Risco zero: só leem o que já está no banco. **Uma rota por commit**, cada uma testada (roteiro
em `16`). O formato exato de entrada e saída está em `20-contrato-api-v1.md`.

## Regras comuns
- Sempre `adminClient()` + `.eq('company_id', companyId)`.
- Paginação com `readPaging` + `.select(cols, { count: 'exact' }).range(from, to)` + `paged(...)`.
- Id de outra empresa ou inexistente → 404 `<recurso>_not_found`.
- Id que não é UUID válido → 404 também (não deixe o Postgres devolver erro 500 de tipo).
- Embeds do PostgREST (`contact:crm_contacts(...)`) só funcionam se houver chave estrangeira.
  `store.js` já usa `crm_leads → crm_contacts`, então essa existe. Para as outras relações,
  confira no P1-00; sem FK, faça uma segunda consulta e junte no código.
- Campos personalizados saem **por nome**: reaproveite `fieldsByName` e o carregamento de
  `custom_fields` que já existem em `api/_lib/v1handlers.js`. Pode **exportar** essas funções
  (acrescentar `export`), sem mudar o corpo delas.

---

### P1-L1 — `GET /v1/pipelines`
`crm_pipelines` (id, name, position) ordenado por `position`; etapas de `crm_stages` (id, name,
color, position) por `pipeline_id`, ordenadas por `position`. Duas consultas (funis da página +
etapas desses funis com `in`). Não exponha `allowed_users`.

### P1-L2 — `GET /v1/leads`
`crm_leads` com `contact:crm_contacts(id,name,phone,email,tags)`. Filtros → `.eq` / `.gte` /
`.lte` sobre `pipeline_id`, `stage_id`, `contact_id`, `priority`, `created_at`, `updated_at`.
`pipeline_name` e `stage_name`: carregue os funis e etapas da empresa uma vez e preencha por mapa.

### P1-L3 — `GET /v1/leads/{id}`
Igual ao item da lista, mas `contact` completo (objeto **Contato** do contrato, com `fields` por
nome). Lead com `contact_id` órfão → `contact: null` (não quebre).

### P1-L4 — `GET /v1/contacts` (listagem)
Só quando **nenhum** de `phone`, `id`, `external_id` vier na query (senão o roteador manda para o
handler antigo — veja `12`). Filtros:
- `name` → `.ilike('name', '%texto%')`; escape `%` e `_` vindos do usuário.
- `tag` → `.contains('tags', [tag])`.
- datas → `created_at` / `updated_at`.
`fields` por nome em cada item (carregue `custom_fields` uma vez por requisição).

### P1-L5 — `GET /v1/users`
`user_profiles` (id, name, email, role, active) da empresa, ordenado por `name`. Nunca devolva
dados do `auth.users`.

### P1-L6 — `GET /v1/conversations`
`conversations` da empresa. `type`: `group` = `remote_jid` termina em `@g.us`
(`.like('remote_jid', '%@g.us')`); `individual` = o contrário (`.not('remote_jid','like','%@g.us')`).
`phone` = dígitos antes do `@` (só para individual). `contact`: `{ id, name }` via `contact_id`.
Ordem por `updated_at` desc — **se a coluna não existir** (P1-00), use `state_since` e anote.

### P1-L7 — `GET /v1/conversations/{id}`
A conversa + `last_message`: a mensagem mais recente de `whatsapp_messages` com o **mesmo
`company_id` e `remote_jid`** (não use só `conversation_id`: mensagens antigas podem não ter).

### P1-L8 — `GET /v1/conversations/{id}/messages`
`whatsapp_messages` por `company_id` + `remote_jid` da conversa, ordenado por `timestamp`
(`order=desc` padrão, `asc` opcional). Colunas do objeto **Mensagem**. Lembre na doc: só 7 dias.

### P1-L9 — `GET /v1/messages/{messageId}`
`whatsapp_messages` por `company_id` + `message_id`. Atenção: `GET /v1/messages` (sem id) é a
rota **antiga** de histórico por telefone e continua igual — o roteador diferencia pelo segmento.

### P1-L10 — `GET /v1/webhook-events`
Devolve `WEBHOOK_EVENTS` de `api/_lib/events.js` (`event` e `description`). Sem banco.

### P1-L11 — `GET /v1/leads/{id}/notes`
Acha o lead (404 se não for da empresa), lista `crm_notes` do `contact_id` dele, paginado,
`created_at` desc.
