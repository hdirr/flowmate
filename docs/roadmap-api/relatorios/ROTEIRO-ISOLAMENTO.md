# Roteiro — teste de isolamento entre empresas (`/v1`)

**Objetivo:** provar com dado real que a chave de uma empresa **nunca** lê nem altera dados de
outra. Empresas: **A** = a do Agadir (`98997d76…`) e **B** = a do tester.

**Só o roteiro; ainda não foi executado.** Pré-requisitos:
- a empresa B existe, com chave de API própria;
- a empresa B tem pelo menos 1 contato, 1 lead, 1 conversa com mensagem e 1 nota (o tester cria
  usando o app e o WhatsApp dele).

## Regras de execução
- **Chaves só por variável de ambiente**, nunca escritas no comando: `FLOWMATE_TEST_KEY` (A) e
  `FLOWMATE_TEST_KEY_B` (B), as duas variáveis de usuário do Windows, lidas pelo nome.
- **Ids de B:** o Agadir obtém com uma consulta SQL de leitura (abaixo). Eles ficam **só no
  scratchpad**; nas evidências entram pseudônimos (`lead-B-001`…).
- **Escritas cruzadas** (passo 3) usam ids reais de B **com a chave de A**. O esperado é 404;
  nada pode mudar em B. Antes e depois, compare B com a chave dela.
- **Resultado esperado em todo cruzamento:** `404 <recurso>_not_found` (nunca 200, 403 ou 500), e
  o corpo **não** pode ecoar dado de B.

## 0. Ids da empresa B (SQL de leitura, rodado pelo Agadir)
```sql
select
  (select id from crm_leads          where company_id = '<COMPANY_B>' limit 1)                   as lead_b,
  (select id from crm_contacts       where company_id = '<COMPANY_B>' limit 1)                   as contato_b,
  (select id from conversations      where company_id = '<COMPANY_B>' limit 1)                   as conversa_b,
  (select message_id from whatsapp_messages where company_id = '<COMPANY_B>' and message_id is not null limit 1) as msg_b,
  (select id from crm_stages s where s.pipeline_id in (select id from crm_pipelines where company_id = '<COMPANY_B>') limit 1) as etapa_b,
  (select id from crm_pipelines      where company_id = '<COMPANY_B>' limit 1)                   as funil_b;
```

## 1. Listas: cada chave só vê a própria empresa
| # | Chamada | Com a chave de A | Com a chave de B |
| --- | --- | --- | --- |
| 1.1 | `GET /pipelines` | só funis de A (nenhum `funil_b`) | só funis de B |
| 1.2 | `GET /leads?pageSize=100` | `lead_b` ausente; `totalItems` = contagem de A | só B |
| 1.3 | `GET /contacts?pageSize=100` | `contato_b` ausente | só B |
| 1.4 | `GET /users` | sem usuários de B | só B |
| 1.5 | `GET /conversations?pageSize=100` (todas as páginas) | `conversa_b` ausente | só B |
| 1.6 | `GET /fields` | sem campos de B | só B |

Conferência: `totalItems` de cada lista = contagem por `company_id` no banco (SQL de contagem
como nas L2–L6).

## 2. Leitura por id cruzado (chave de A, ids de B)
| # | Chamada | Esperado |
| --- | --- | --- |
| 2.1 | `GET /leads/{lead_b}` | 404 `lead_not_found` |
| 2.2 | `GET /leads/{lead_b}/notes` | 404 `lead_not_found` |
| 2.3 | `GET /conversations/{conversa_b}` | 404 `conversation_not_found` |
| 2.4 | `GET /conversations/{conversa_b}/messages` | 404 `conversation_not_found` |
| 2.5 | `GET /messages/{msg_b}` | 404 `message_not_found` |
| 2.6 | `GET /contacts?id={contato_b}` (rota antiga) | 404 `contact_not_found` |
| 2.7 | `GET /leads?pipelineId={funil_b}` / `?stageId={etapa_b}` / `?contactId={contato_b}` | 200 com `items: []` |
| 2.8 | `GET /conversations?contactId={contato_b}` | 200 com `items: []` |

## 3. Escrita cruzada (chave de A, ids de B) — nada pode mudar em B
| # | Chamada | Esperado |
| --- | --- | --- |
| 3.1 | `PATCH /leads/{lead_b}` `{ "priority": true }` | 404 `lead_not_found` |
| 3.2 | `PATCH /leads/{lead_A}` `{ "stage_id": "{etapa_b}" }` (lead de A para etapa de B) | 400 `stage_not_found` |
| 3.3 | `POST /contacts/{contato_b}/tags` `{ "tags": ["isolamento"] }` | 404 `contact_not_found` |
| 3.4 | `PATCH /conversations/{conversa_b}` `{ "state": "human" }` | 404 `conversation_not_found` |
| 3.5 | `PATCH /contacts` `{ "contact_id": "{contato_b}", "name": "X" }` (rota antiga) | 404 `contact_not_found` |
| 3.6 | `POST /notes` `{ "contact_id": "{contato_b}", "text": "X" }` (rota antiga) | 404 `contact_not_found` |
| 3.7 | `POST /leads` `{ "external_id": "<external_id de um contato de B>", "name": "X" }` | **cria em A** (o `external_id` é por empresa) e não toca em B; conferir em B |

**Depois do passo 3:** repetir, com a chave de B, `GET /leads/{lead_b}`,
`GET /contacts?id={contato_b}` e `GET /conversations/{conversa_b}`, e comparar com o estado
anterior. Deve sair idêntico, ignorando só o `updated_at` se o tester tiver mexido no app.

## 4. Webhooks
| # | Ação | Esperado |
| --- | --- | --- |
| 4.1 | Mover um lead de A pela API | evento só na URL de webhook de A, com `company_id` de A |
| 4.2 | Mover um lead de B (chave de B) | evento só na URL de B, assinado com o segredo de B (o nó Code de A recusa) |
| 4.3 | Mensagem recebida em B | `message.received` só para B |

## 5. Critério de aprovação
Todos os cruzamentos dão 404 (ou lista vazia, onde indicado), nenhum dado de B aparece em
corpo de resposta ou evento de A, e B fica igual antes e depois do passo 3. Qualquer 200 com
dado da outra empresa é **bloqueante**: reverter a rota responsável e investigar.
