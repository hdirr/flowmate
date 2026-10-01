# 31 — Parte 2, bloco 1: lead como negócio completo (DESENHO)

> Não implementar sem liberação do Agadir. Ver `30-parte2-visao.md`.

## Problema
Hoje o lead é só "contato numa etapa" (+ `priority`). "Perdido" significa **apagar** o lead
(`store.leads.remove` dispara o gatilho `lead_lost`), então o histórico e a métrica de perda
somem. Na Helena o card tem título, valor, responsável, prazo, status aberto/ganho/perdido/
arquivado e motivo de perda, e o IVE CRM usa isso no dia a dia (revisado em 01/10/2026).

## Modelo de dados (fase A — só acrescenta)

```sql
-- crm_leads
alter table public.crm_leads
  add column if not exists title               text,
  add column if not exists description         text,
  add column if not exists value               numeric(14,2),  -- NOTA (P1-L3): a coluna JÁ EXISTE (numeric, default 0); o bloco 1 só precisa da tela e do PATCH
  add column if not exists responsible_user_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists due_date            timestamptz,
  add column if not exists status              text not null default 'open'
                                               check (status in ('open','won','lost','archived')),
  add column if not exists lost_reason_id      uuid,
  add column if not exists closed_at           timestamptz,
  add column if not exists number              integer;   -- código legível por empresa (FDV-12)

-- motivos de perda (por funil; pipeline_id nulo = vale para todos)
create table if not exists public.crm_lost_reasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  pipeline_id uuid references public.crm_pipelines(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.crm_leads
  add constraint crm_leads_lost_reason_fk foreign key (lost_reason_id)
  references public.crm_lost_reasons(id) on delete set null;   -- (guardar com "if not exists" via DO block)

-- fase da etapa (para relatórios: entrada / meio / final)
alter table public.crm_stages
  add column if not exists phase text not null default 'none' check (phase in ('none','initial','final'));
```
+ RLS `tenant_isolation` em `crm_lost_reasons` (mesmo padrão do `supabase_rls.sql`) + índices
`crm_leads(company_id, status)`, `crm_leads(responsible_user_id)`.

**Número do lead:** um `number` sequencial por empresa, preenchido por `trigger` `before insert`
usando uma tabela de contadores (`company_counters(company_id, name, value)`) com
`update ... returning` (atômico). Não use `max()+1` (corrida). Preencher os leads existentes em
ordem de `created_at` num script único. O prefixo exibido (`FDV-`) depende da decisão em aberto.

## Comportamento

| Ação | Hoje | Depois |
| --- | --- | --- |
| Marcar como perdido | Apaga o lead | `status='lost'`, `lost_reason_id`, `closed_at=now()`. Some do quadro (filtro), aparece em "Perdidos" |
| Marcar como ganho | Não existe | `status='won'`, `closed_at`, valor obrigatório? (decidir) |
| Arquivar | Não existe | `status='archived'` |
| Reabrir | — | volta para `open`, limpa `closed_at` e motivo |
| Excluir | Apaga | Continua existindo, separado, só admin/gestor |
| Gatilho `lead_lost` das automações | Ao apagar | Ao virar `lost` (fase A: dispara nos dois; fase B: só no status) |

## Tela (`src/pages/Pipeline.jsx`, `LeadPanel.jsx`, `Dashboard.jsx`)
- Card mostra número, título (ou nome do contato), valor, responsável, prazo (vermelho se vencido).
- Painel do lead: campos novos editáveis; botões **Ganho** / **Perdido** (pede motivo) / **Arquivar**.
- Quadro filtra `status='open'` por padrão; abas ou filtro para Ganhos/Perdidos/Arquivados.
- Configurações do funil: cadastrar motivos de perda; marcar fase da etapa.
- Dashboard: valor em aberto por etapa, ganhos e perdas no período, taxa de conversão, principais
  motivos de perda.

## API
- `PATCH /v1/leads/{id}` passa a aceitar `title`, `description`, `value`, `responsible_user_id`,
  `due_date`, `status`, `lost_reason_id` (ou `lost_reason_name`).
- `GET /v1/leads` ganha filtros `status` (lista), `responsibleUserId`, `dueBefore`, `overdue=true`.
- `POST /v1/leads` aceita os mesmos campos na criação.
- `GET /v1/pipelines/{id}/lost-reasons`.
- Eventos: `lead.updated` com `changes`; novo `lead.status_changed`
  `{ lead_id, status, previous_status, lost_reason, value }` (facilita fluxos de pós-venda no n8n).

## Riscos
- Contagem de leads no Dashboard e nos quadros muda (perdidos deixam de sumir) → comunicar.
- Automações existentes com gatilho `lead_lost` precisam continuar disparando (fase A cobre).
- `responsible_user_id` x `allowed_users` do funil: responsável precisa ter acesso ao funil;
  validar no servidor e na tela.

## Aceite
Marcar perdido com motivo pela tela e pela API; o lead some do quadro, aparece em Perdidos,
reabre; Dashboard mostra o motivo; automação com gatilho `lead_lost` dispara uma vez; nenhum lead
existente perde dados.
