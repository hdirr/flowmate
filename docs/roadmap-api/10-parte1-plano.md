# 10 — Parte 1: plano de execução

**Regra da Parte 1:** só acrescenta. Nenhuma rota existente muda de resposta, nenhuma tabela
muda de significado, o fluxo de mensagens do WhatsApp não é tocado (com duas exceções
pontuais, P1-W1 e P1-W2). Cada tarefa vai para produção sozinha e é testada antes da próxima.

Decisões já tomadas pelo Agadir (01/10/2026):
- **Paginação no formato da Helena:** `pageNumber` + `pageSize` (máx. 100); resposta
  `{ pageNumber, pageSize, totalPages, totalItems, hasMorePages, items }`.
- **Plano Pro na `/v1`: adiado** para o lançamento. Durante os testes, qualquer empresa com chave
  usa a `/v1`. Não implemente a trava de plano.

## Ordem das tarefas

Faça nesta ordem. ⛔ = não comece sem a condição indicada.

| # | ID | Tarefa | Arquivo | SQL? | Condição |
| --- | --- | --- | --- | --- | --- |
| 1 | P1-00 | Levantar o esquema real do banco | este arquivo, abaixo | Agadir roda consulta | — |
| 2 | P1-S1 | Webhook da AbacatePay recusa sem segredo | `11` | — | — |
| 3 | P1-S2 | Trava de assinatura fecha quando o status é desconhecido + tela de Onboarding | `11` | consulta de conferência | — |
| 4 | P1-S4 | `/api/integrations/emit` aceita só eventos e ids válidos | `11` | — | — |
| 5 | P1-S5 | Tirar chave e `company_id` de exemplo do `INTEGRATIONS.md` | `11` | — | — |
| 5b | P1-S6 | Exemplo de verificação HMAC na tela de Integrações (corpo bruto, tempo constante, janela 5 min) — criada pelo tutor depois do plano | `Settings.jsx` | — | — |
| 6 | P1-B1 | Roteador por segmentos + helpers (erro, paginação) + catálogo de eventos | `12` | — | — |
| 7 | P1-B2 | Aceitar `Authorization: Bearer` | `12` | — | — |
| 7b | P1-B3 | Rotas da /v1 com mais de um segmento (`vercel.json` + derivação da rota) — criada pelo tutor depois do plano; antes de qualquer rota com id | `vercel.json` | — | — |
| 8 | P1-L1 a P1-L11 | Rotas de leitura (uma por commit) | `13` | — | — |
| 9 | P1-E1 | Coluna `metadata` em contato e lead | `14` | **sim** | — |
| 10 | P1-E2 a P1-E7 | Escritas (uma por commit) | `14` | — | P1-E1 |
| 11 | P1-E0 | Corrigir montagem do JID nas rotas antigas | `14` | — | ⛔ aprovação do tutor |
| 12 | P1-W1 | Evento `conversation.state_changed` | `15` | — | — |
| 13 | P1-W3 | Novos eventos na tela de Integrações + `GET /v1/webhook-events` completo | `15` | — | — |
| 14 | P1-S3 | Webhook da Evolution recusa sem segredo | `11` | — | ⛔ `WEBHOOK_SECRET` na Vercel e mensagens chegando |
| 15 | P1-W2 | Evento `whatsapp.connection` | `15` | — | ⛔ depois do P1-S3 |
| 16 | P1-Z | Atualizar `INTEGRATIONS.md` e `HANDOFF.md` | `15` | — | fim |

## P1-00 — Levantar o esquema real

Peça ao Agadir para rodar no SQL Editor do Supabase e colar o resultado (ele pode exportar CSV):

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'companies','user_profiles','company_integrations',
    'crm_pipelines','crm_stages','crm_contacts','crm_leads','crm_notes','custom_fields',
    'conversations','whatsapp_messages','whatsapp_instances','whatsapp_groups'
  )
order by table_name, ordinal_position;
```

Grave o resultado, formatado como tabela por tabela, em `docs/roadmap-api/esquema-atual.md`.
Depois **confira cada tarefa contra ele**: se uma coluna citada nas tarefas não existir (ou tiver
outro nome), anote no relatório `P1-00.md` e pergunte antes de seguir. Pontos a confirmar:

- `custom_fields`: coluna `type` ou `field_type`?
- `conversations`: tem `created_at`, `updated_at`, `state_by`, `contact_id`?
- `crm_leads`: tem `created_at`, `updated_at`, `priority`, `pipeline_id`?
- `crm_contacts`: tem `external_id`, `fields`, `tags`, `created_at`, `updated_at`?
- `user_profiles`: tem `email`?
- `whatsapp_instances`: tem `status`, `phone`, `updated_at`?

Commit: `docs(P1-00): esquema atual do banco`.

## Adiado (não fazer)

- Trava do plano Pro na `/v1` — no lançamento, junto com `PUBLISHED = true` em `src/lib/pricing.js`.
- Limite de requisições (rate limit) — precisa de contador compartilhado; Parte 2, bloco 13.
- Remover a chave pela URL (`?key=`) — quebra quem usa; avaliar no lançamento.
