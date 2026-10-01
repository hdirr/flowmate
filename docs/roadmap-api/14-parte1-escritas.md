# 14 — Parte 1: escritas (P1-E*)

Cada rota grava os mesmos campos que a tela já grava. Contrato exato em `20-contrato-api-v1.md`.
**Uma rota por commit.**

## Limitação conhecida (documente, não resolva)
As automações da tela (`flowmate_workflows`) rodam no navegador (`runAutomations` em
`src/lib/store.js`). Nada criado ou alterado pela API dispara essas automações — o mesmo que já
acontece hoje com o `POST /v1/leads`. Os **webhooks** disparam normalmente. Escreva isso no
`INTEGRATIONS.md` na P1-Z. A solução é a Parte 2, bloco 16.

---

## P1-E1 — Coluna `metadata` em contato e lead (SQL)

Arquivo `supabase_metadata.sql` (idempotente, com cabeçalho e ROLLBACK comentado):

```sql
begin;
alter table public.crm_contacts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_leads    add column if not exists metadata jsonb not null default '{}'::jsonb;
commit;

-- ROLLBACK:
-- alter table public.crm_contacts drop column if exists metadata;
-- alter table public.crm_leads    drop column if exists metadata;
```

Pare e peça ao Agadir para rodar. Depois:
- As rotas de leitura novas (P1-L2, L3, L4) passam a devolver `metadata`.
- **Não** acrescente `metadata` na resposta das rotas antigas.
- Helper `mergeMetadata(atual, novo)`: chave com valor `null` é removida; as outras são
  sobrescritas; chaves não enviadas ficam. Limite: 50 chaves e 16 KB serializado
  (`400 metadata_too_large`).

Para que serve: o n8n guarda ali o id do cliente no outro sistema, a origem do lead etc., sem
precisar criar campo personalizado.

---

## P1-E2 — `POST /v1/contacts` (criar, sem quebrar o apelido antigo)

**Cuidado:** hoje `handleContacts` trata `POST` igual a `PATCH` (atualiza contato existente,
404 se não acha). Esse uso não está documentado, mas pode existir em algum fluxo. Leia o
contrato (`20`) com atenção:
1. Contato existe → chame o handler antigo **sem alterar a lógica dele** e acrescente
   `created: false` na resposta. (Pode envolver a chamada: rode a lógica antiga e complete o JSON.)
   Exceção: `options.upsert === false` → `409 contact_exists`.
2. Contato não existe → cria (`name` obrigatório), `201`.
- Reaproveite `resolveContact` e `resolveFieldKeys`.
- Telefone gravado como veio (igual ao `POST /v1/leads` faz hoje). Não normalize nesta tarefa.
- `created_by` fica `null` (veio da API).
- Eventos: `contact.created` (criou) com o **mesmo payload** que a tela manda hoje
  (`{ contact_id, name, phone, email }`) + `source: "api"`; `contact.updated` (atualizou e mudou algo).
- Teste obrigatório extra: `POST /v1/contacts` com `phone` de contato existente e `{"name":"X"}`
  continua atualizando o nome, como hoje.

## P1-E3 — `POST /v1/contacts/{id}/tags`
- Lê `tags` atuais, aplica a operação, grava o array (sem duplicatas, mantendo a ordem).
- `added`/`removed` = diferença real. Nada mudou → `200` sem evento.

## P1-E4 — `PATCH /v1/leads/{id}`
- Reaproveite `resolveStage` (já existe em `v1handlers.js`; exporte se preciso).
- Etapa inválida → `400 stage_not_found`.
- Grave `updated_at = now()` junto (se a coluna existir — P1-00).
- `lead.moved` com o mesmo formato que `PATCH /v1/contacts` já usa:
  `{ contact_id, lead_id, stage_id, pipeline_id, source: 'api' }`.

## P1-E5 — `POST /v1/leads/{id}/notes`
- `text` obrigatório e até 8000 caracteres (`400 missing_text` / `text_too_long`).
- Insert em `crm_notes` `{ company_id, contact_id, text, auto: true }` (igual `handleNotes`).

## P1-E6 — `PATCH /v1/conversations/{id}`
- Chama `setConversationState(conversation.id, state, null, 'api')` (o 4º parâmetro vem na P1-W1;
  se fizer esta tarefa antes, passe só os 3 e ajuste na W1).
- Mesmo estado que já está → `200` sem evento.
- Grupo → `422 unsupported_for_group`.

## P1-E7 — `POST /v1/conversations/{id}/messages`
- Busca a conversa, valida o JID (`@s.whatsapp.net` ou `@g.us`; senão `422 unsupported_jid`).
- Chama `sendMessage({ companyId, to: conversation.remote_jid, content, media, sender: 'automation' })`.
  **Não altere `sendMessage`.** Ele já trata grupo (`@g.us`) e o 409.
- Mesmas respostas de erro do `POST /v1/messages` atual.
- **Teste de envio real só para o contato de teste combinado com o Agadir.**

---

## P1-E0 — Corrigir o JID nas rotas antigas ⛔ (só com aprovação do tutor)

`GET /v1/contacts` e `GET /v1/messages` montam `${digits(phone)}@s.whatsapp.net`, sem o `55`
que o resto do sistema põe (`jidFor` em `api/_lib/db.js`). Contato salvo como `31999998888` não
acha a conversa (`conversation: null`, histórico vazio). A correção é trocar por `jidFor(phone)`.

É mudança de comportamento de rota existente (para melhor), por isso só com aprovação. Antes,
descreva no relatório quantos contatos da empresa de teste têm telefone sem `55`
(o Agadir roda: `select count(*) from crm_contacts where phone !~ '^\+?55';`).
