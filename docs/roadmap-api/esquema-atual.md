# Esquema atual do banco (P1-00)

Levantado em 01/10/2026 via `information_schema.columns` (schema `public`), rodado pelo Agadir
no SQL Editor do Supabase. **Fonte da verdade para as tarefas da Parte 1** — não suponha
colunas além destas.

Legenda: `null?` = `is_nullable`. Default omitido quando é `null`.

> A primeira consulta veio cortada em 100 linhas (limite do SQL Editor); `whatsapp_instances`
> e `whatsapp_messages` vieram de uma segunda consulta só com elas. FKs, gatilhos e a contagem
> de `company_id` nulo vieram de consultas à parte (fim do arquivo).

## companies
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| name | text | não | |
| slug | text | sim | |
| plan | text | não | `'free'` |
| created_at | timestamptz | não | `now()` |
| updated_at | timestamptz | não | `now()` |
| abacate_customer_id | text | sim | |
| abacate_billing_id | text | sim | |
| plan_level | text | sim | |
| plan_tier | text | sim | `'t1'` |
| plan_cycle | text | sim | `'mensal'` |
| subscription_status | text | sim | |
| line_cap | integer | sim | `0` |
| current_period_end | timestamptz | sim | |

Obs.: **não há colunas `asaas_*`** (o HANDOFF diz que existem como legado). As `abacate_*`
existem → `supabase_abacate.sql` foi rodada.

## company_integrations
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| company_id | uuid | não | |
| webhook_url | text | sim | |
| webhook_events | text[] | sim | `'{}'` |
| api_key | text | sim | uuid sem hífens (32 hex) |
| enabled | boolean | sim | `true` |
| created_at | timestamptz | sim | `now()` |
| webhook_secret | text | sim | 2× uuid sem hífens (64 hex) |

## user_profiles
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | |
| company_id | uuid | não | |
| name | text | não | |
| role | text | não | `'seller'` |
| is_primary | boolean | não | `false` |
| active | boolean | não | `true` |
| created_at | timestamptz | não | `now()` |
| updated_at | timestamptz | não | `now()` |
| email | text | sim | |

## crm_pipelines
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | não | |
| name | text | não | |
| position | integer | sim | `0` |
| allowed_users | uuid[] | sim | `'{}'` |
| created_by | uuid | sim | |
| created_at | timestamptz | sim | `now()` |

## crm_stages
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| name | text | não | |
| color | text | sim | `'#6366f1'` |
| position | integer | não | |
| company_id | uuid | **sim** | |
| created_by | uuid | sim | |
| pipeline_id | uuid | sim | |

## crm_contacts
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| name | text | não | |
| phone | text | sim | |
| email | text | sim | |
| created_at | timestamptz | sim | `now()` |
| company_id | uuid | **sim** | |
| created_by | uuid | sim | |
| fields | jsonb | não | `'{}'` |
| tags | text[] | não | `'{}'` |
| updated_at | timestamptz | não | `now()` |
| external_id | text | sim | |

## crm_leads
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| contact_id | uuid | sim | |
| stage_id | uuid | sim | |
| value | numeric | sim | `0` |
| created_at | timestamptz | sim | `now()` |
| company_id | uuid | **sim** | |
| created_by | uuid | sim | |
| priority | boolean | não | `false` |
| updated_at | timestamptz | não | `now()` |
| pipeline_id | uuid | sim | |

## crm_notes
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | não | |
| contact_id | uuid | não | |
| user_id | uuid | sim | |
| text | text | não | |
| auto | boolean | não | `false` |
| created_at | timestamptz | não | `now()` |

## custom_fields
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | não | |
| name | text | não | |
| **field_type** | text | não | `'text'` |
| options | text[] | não | `'{}'` |
| created_by | uuid | sim | |
| created_at | timestamptz | não | `now()` |

⚠️ A coluna é `field_type`, **não** `type`. `api/_lib/v1handlers.js` seleciona `type` em três
consultas (linhas 42, 101, 121), e o front também usa `type` (cria com `type:` e lê
`field.type`). Ver relatório P1-00.

## conversations
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | não | |
| contact_id | uuid | sim | |
| remote_jid | text | não | |
| state | text | não | `'automation'` |
| state_since | timestamptz | sim | `now()` |
| state_by | uuid | sim | |
| created_at | timestamptz | sim | `now()` |
| updated_at | timestamptz | sim | `now()` |

## whatsapp_groups
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | não | |
| instance_name | text | não | |
| jid | text | não | |
| name | text | não | |
| description | text | sim | |
| participant_phones | jsonb | não | `'[]'` |
| created_by | uuid | sim | |
| created_at | timestamptz | não | `now()` |
| updated_at | timestamptz | não | `now()` |

## whatsapp_instances
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | sim | |
| instance_name | text | não | |
| status | text | sim | `'disconnected'` |
| phone | text | sim | |
| created_at | timestamptz | sim | `now()` |
| updated_at | timestamptz | não | `now()` |

Obs.: `updated_at` existe **com gatilho** → `supabase_whatsapp_cache.sql` foi rodada (o HANDOFF
diz que não).

## whatsapp_messages
| coluna | tipo | null? | default |
| --- | --- | --- | --- |
| id | uuid | não | `gen_random_uuid()` |
| company_id | uuid | sim | |
| instance_name | text | não | |
| remote_jid | text | não | |
| from_me | boolean | sim | `false` |
| message_type | text | sim | |
| content | text | sim | |
| timestamp | bigint | sim | |
| status | text | sim | `'received'` |
| contact_name | text | sim | |
| created_at | timestamptz | sim | `now()` |
| message_id | text | sim | |
| conversation_id | uuid | sim | |
| sender | text | sim | |
| participant_jid | text | sim | |
| media_url | text | sim | |
| file_name | text | sim | *(ver obs.)* |

Obs.: a consulta devolveu 24 linhas para as duas tabelas; os prints mostraram 23. A linha não
visível é, quase certamente, `file_name` (texto, aceita nulo): o webhook grava essa coluna em
todo insert e as mensagens estão chegando (HANDOFF, 28/09).

Nomes que diferem do contrato (`20`): a coluna é `message_type` (contrato: `type`) e
`whatsapp_messages` não tem `updated_at`. O objeto **Mensagem** mapeia `message_type → type`.

---

## Chaves estrangeiras (todas as existentes nessas tabelas)
| tabela.coluna | → referência |
| --- | --- |
| crm_contacts.company_id | companies.id |
| crm_leads.company_id | companies.id |
| crm_leads.contact_id | crm_contacts.id |
| crm_leads.stage_id | crm_stages.id |
| crm_notes.company_id | companies.id |
| crm_notes.contact_id | crm_contacts.id |
| crm_stages.company_id | companies.id |
| custom_fields.company_id | companies.id |
| whatsapp_instances.company_id | companies.id |
| whatsapp_messages.company_id | companies.id |

**Sem FK** (embed do PostgREST não funciona; fazer segunda consulta e juntar no código):
- `crm_leads.pipeline_id`, `crm_stages.pipeline_id`, `crm_pipelines.company_id`
- `conversations.*` (nenhuma FK: nem `company_id`, nem `contact_id`)
- `whatsapp_messages.conversation_id`
- `crm_notes.user_id`, `*.created_by` (nenhuma para `auth.users`)

Embeds que funcionam: `crm_leads → crm_contacts` (`contact:crm_contacts(...)`),
`crm_leads → crm_stages`, `crm_notes → crm_contacts`.

## Gatilhos (`BEFORE UPDATE … EXECUTE FUNCTION set_updated_at()`)
| tabela | gatilho |
| --- | --- |
| crm_contacts | set_updated_at_crm_contacts |
| crm_leads | set_updated_at_crm_leads |
| user_profiles | set_updated_at_user_profiles |
| whatsapp_instances | set_updated_at_whatsapp_instances |

`conversations` **não** tem gatilho: `updated_at` só muda quando o código grava
(`setConversationState` grava; mensagem nova **não** mexe). Logo, ordenar conversas por
`updated_at` = "última mudança de estado", não "última mensagem".

## Linhas com `company_id` nulo (contagem em 01/10/2026)
| tabela | linhas |
| --- | --- |
| crm_contacts | 0 |
| crm_leads | 0 |
| crm_stages | 5 |

São invisíveis para a API e para a tela (todo filtro é por `company_id`). Não corrigir agora.
