-- ============================================================================
-- FlowMate — SQL único da CF-A (PLANO-CONFIABILIDADE.md) + ET-0 (PLANO-ETIQUETAS.md)
-- ----------------------------------------------------------------------------
-- Rode no SQL Editor do Supabase, NA ORDEM, uma parte por vez (cada uma é uma
-- transação). Pare e me mande o resultado se qualquer conferência não bater.
-- CONFERÊNCIAS (PARTES 0 e 8): o SQL Editor mostra só o resultado da ÚLTIMA consulta.
-- Selecione e rode UMA consulta por vez (selecionar o trecho + Run).
-- HORÁRIO: rode as PARTES 3 e 6 em horário de pouco movimento — criar índice/gatilho e o
-- backfill seguram as escritas em whatsapp_messages / conversations / crm_contacts até o
-- commit (segundos, no volume de hoje); o webhook espera nesse intervalo.
--
--   PARTE 0  conferências ANTES (só leitura)                   → me mande o resultado
--   PARTE 1  segurança: companies só leitura para a tela + chaves por empresa (features)
--   PARTE 2  A1/A3: caixa de entrada durável (inbound_events)
--   PARTE 3  A2: chave única de mensagem por empresa  (só se a PARTE 0 não achar duplicata)
--   PARTE 4  A4/A5: marcador de reconciliação, saúde e alertas
--   PARTE 5  A6: fila de envio (outbound_messages)
--   PARTE 6  ET-0: etiquetas (tabelas, funções, gatilhos, backfill, migração dos estados)
--   PARTE 7  A3: agendador (pg_cron + pg_net + segredo no Vault)  — exige JOBS_SECRET na Vercel
--   PARTE 8  conferências DEPOIS (só leitura)                  → me mande o resultado
--   ROLLBACK no fim (comentado), por parte.
--
-- Nada aqui liga comportamento novo: todas as chaves de companies.features nascem
-- desligadas. A única mudança de comportamento imediata é a PARTE 1 (a tela deixa de
-- poder ALTERAR a linha da própria empresa; ela só lê — ver o motivo lá).
-- Idempotente: as PARTES 1 a 6 podem rodar de novo. A PARTE 7 também (o segredo é
-- atualizado se já existir) e rodar o cron.schedule de novo só atualiza o agendamento 'flowmate-jobs'.
-- ============================================================================


-- ============================================================================
-- PARTE 0 — conferências ANTES (só leitura). Me mande os resultados.
-- ============================================================================

-- 0.1 Quantos message_id repetidos DENTRO da mesma empresa (bloqueiam a PARTE 3).
--     Esperado: 0. Se > 0, me mande o número e PARE (não rode a PARTE 3).
select count(*) as repetidos_na_empresa from (
  select company_id, message_id from public.whatsapp_messages
   where message_id is not null
   group by company_id, message_id having count(*) > 1) x;

-- 0.2 Quantos message_id aparecem em MAIS DE UMA empresa (o caso que hoje some)
select count(*) as em_mais_de_uma_empresa from (
  select message_id from public.whatsapp_messages
   where message_id is not null
   group by message_id having count(distinct company_id) > 1) x;

-- 0.3 Índices que existem hoje nas tabelas de WhatsApp. Confira em especial:
--     conversations_pkey (as PARTES 5 e 6 dependem dela) e se há índice ÚNICO só em
--     whatsapp_messages(message_id) — a "chave global" do diagnóstico.
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename in ('whatsapp_messages','whatsapp_instances','conversations')
 order by tablename, indexname;

-- 0.4 Extensões disponíveis/instaladas para o agendador
select name, installed_version, default_version
  from pg_available_extensions
 where name in ('pg_cron','pg_net','supabase_vault');

-- 0.5 Tags que NÃO cabem numa etiqueta (vazias/só espaços, > 100 caracteres, nome de
--     sistema). São puladas na migração (o array não muda). Só contagens.
select count(*) filter (where length(btrim(t)) = 0)                       as vazias,
       count(*) filter (where length(btrim(t)) > 100)                     as longas,
       count(*) filter (where t in ('Atendimento humano','Atendimento IA')) as nome_de_sistema
  from public.crm_contacts c, unnest(coalesce(c.tags,'{}')) t;

-- 0.6 Conversas por tipo e estado (base da conferência da PARTE 8)
select (remote_jid like '%@g.us' or remote_jid like '%@broadcast' or remote_jid like '%@newsletter') as grupo,
       state, count(*)
  from public.conversations group by 1,2 order by 1,2;

-- 0.7 As tabelas novas ainda NÃO existem (esperado: todas null). Se alguma não for null,
--     me mande: o "create table if not exists" pularia em silêncio.
select to_regclass('public.inbound_events') as inbound_events, to_regclass('public.labels') as labels,
       to_regclass('public.contact_labels') as contact_labels, to_regclass('public.conversation_labels') as conversation_labels,
       to_regclass('public.outbound_messages') as outbound_messages, to_regclass('public.line_sync_state') as line_sync_state,
       to_regclass('public.ops_alerts') as ops_alerts;

-- 0.8 Políticas atuais de companies (a PARTE 1 troca todas por só leitura)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'companies';

-- ============================================================================
-- PARTE 1 — segurança + chaves por empresa
-- ----------------------------------------------------------------------------
-- CORREÇÃO DO REGISTRO (2026-10-13, depois de rodar): no banco, companies JÁ estava só
-- leitura (tenant_read) desde 29/09/2026 — o Agadir fechou direto no banco
-- (docs/roadmap-api/11-parte1-seguranca.md), sem SQL no repo. O "achado" abaixo foi tirado
-- só dos arquivos do repo (supabase_rls.sql) e estava DESATUALIZADO. Esta parte apenas
-- confirmou o estado (a 0.8 mostrou só tenant_read antes). Texto original:
-- ACHADO (2026-10-13): a política "tenant_isolation" de companies é FOR ALL. Qualquer
-- usuário logado pode ALTERAR a linha da própria empresa pela anon key — inclusive
-- subscription_status ('active' sem pagar), plan_level e line_cap. A tela só LÊ
-- companies (src/lib/auth.js); todas as escritas são do servidor (service_role, que
-- ignora RLS). Então: leitura para o usuário, escrita só pelo servidor.
-- (register_company é SECURITY DEFINER: o onboarding continua funcionando.)
-- ============================================================================
begin;

drop policy if exists tenant_isolation        on public.companies;
drop policy if exists "companies: own company" on public.companies;   -- política antiga (supabase_migration.sql)
drop policy if exists tenant_read             on public.companies;
create policy tenant_read on public.companies
  for select to authenticated
  using (id = public.get_my_company_id());

-- Chaves liga/desliga por empresa. Todas desligadas. Só o servidor grava (política acima).
alter table public.companies add column if not exists features jsonb not null default '{}'::jsonb;

commit;


-- ============================================================================
-- PARTE 2 — A1/A3: caixa de entrada durável
-- Cada evento que a Evolution manda vira UMA linha (um messages.upsert com N mensagens
-- vira N linhas), gravada ANTES de processar. Só o servidor lê/grava (RLS sem política).
-- ============================================================================
begin;

create table if not exists public.inbound_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete cascade,
  instance_name  text not null,
  event          text not null,                 -- messages.upsert | connection.update | ...
  message_id     text,                          -- key.id (só messages.upsert)
  remote_jid     text,
  payload        jsonb not null,                -- a mensagem/evento cru
  status         text not null default 'pending'
                 check (status in ('pending','processing','done','failed','dead','ignored')),
  attempts       integer not null default 0,
  last_error     text,
  next_attempt_at timestamptz not null default now(),
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  locked_at      timestamptz
);
-- Reenvio da Evolution não duplica: uma linha por (empresa, instância, evento, mensagem).
create unique index if not exists inbound_events_dedup
  on public.inbound_events (company_id, instance_name, event, message_id);
create index if not exists inbound_events_todo
  on public.inbound_events (status, next_attempt_at) where status in ('pending','failed');
create index if not exists inbound_events_company_time
  on public.inbound_events (company_id, received_at desc);
alter table public.inbound_events enable row level security;   -- sem política: só service_role

-- Pega um lote para processar sem dois processadores pegarem o mesmo evento.
create or replace function public.claim_inbound_events(p_limit int default 50)
returns setof public.inbound_events
language sql security definer set search_path = public as $$
  update public.inbound_events e
     set status = 'processing', locked_at = now(), attempts = e.attempts + 1
   where e.id in (
     select id from public.inbound_events
      where (status in ('pending','failed') and next_attempt_at <= now())
         or (status = 'processing' and locked_at < now() - interval '5 minutes')  -- travado
      order by received_at
      limit p_limit
      for update skip locked)
  returning e.*;
$$;
revoke execute on function public.claim_inbound_events(int) from public, anon, authenticated;
grant  execute on function public.claim_inbound_events(int) to service_role;

commit;


-- ============================================================================
-- PARTE 3 — A2: chave única de mensagem POR EMPRESA
-- SÓ RODE se a consulta 0.1 voltou 0. Se voltou mais que 0, me mande o número e pare aqui.
-- A chave global que talvez exista hoje (ver 0.3) NÃO é removida agora: o código passa a
-- usar a nova; a remoção vem depois, num passo separado (contrair).
-- ============================================================================
begin;
create unique index if not exists whatsapp_messages_company_message_uniq
  on public.whatsapp_messages (company_id, message_id);
commit;


-- ============================================================================
-- PARTE 4 — A4/A5: reconciliação, saúde e alertas (só o servidor lê/grava)
-- ============================================================================
begin;

create table if not exists public.line_sync_state (
  company_id        uuid not null references public.companies(id) on delete cascade,
  instance_name     text not null,
  reconciled_until  bigint,                      -- timestamp (s) até onde já conferiu
  last_run_at       timestamptz,
  last_ok_at        timestamptz,
  recovered_total   integer not null default 0,  -- mensagens que a reconciliação gravou
  last_recovered    integer not null default 0,
  last_error        text,
  primary key (company_id, instance_name)
);
alter table public.line_sync_state enable row level security;

create table if not exists public.ops_alerts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,   -- null = infra
  kind         text not null,     -- line_disconnected | write_failing | dead_events | evolution_down | disk_high
  subject      text not null,     -- ex.: instance_name
  detail       text,
  opened_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz
);
-- No máximo um alerta ABERTO por (empresa, tipo, assunto): sem spam. (Índice parcial: o
-- código faz insert e trata o 23505 — o upsert do supabase-js não usa índice parcial.)
create unique index if not exists ops_alerts_open_uniq
  on public.ops_alerts (coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid), kind, subject)
  where resolved_at is null;
alter table public.ops_alerts enable row level security;

commit;


-- ============================================================================
-- PARTE 5 — A6: fila de envio
-- ============================================================================
begin;

create table if not exists public.outbound_messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  instance_name   text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  remote_jid      text not null,
  sender          text not null check (sender in ('automation','human')),
  actor_user_id   uuid,
  content         text,
  media           jsonb,
  idempotency_key text,                           -- header Idempotency-Key da /v1 (opcional)
  status          text not null default 'pending'
                  check (status in ('pending','sending','sent','failed','dead')),
  attempts        integer not null default 0,
  last_error      text,
  message_id      text,                           -- id que a Evolution devolveu
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create unique index if not exists outbound_messages_idem
  on public.outbound_messages (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists outbound_messages_todo
  on public.outbound_messages (status, next_attempt_at) where status in ('pending','failed');
create index if not exists outbound_messages_echo
  on public.outbound_messages (company_id, remote_jid, created_at desc);
alter table public.outbound_messages enable row level security;
drop policy if exists tenant_read on public.outbound_messages;
create policy tenant_read on public.outbound_messages            -- a tela vê o status; não grava
  for select to authenticated using (company_id = public.get_my_company_id());

commit;


-- ============================================================================
-- PARTE 6 — ET-0: etiquetas (PLANO-ETIQUETAS.md)
-- Regras: gatilhos à prova de falha (nunca derrubam a escrita de conversa/contato),
-- sem recursão, grupos sem etiqueta de sistema, tags que não cabem são puladas,
-- tabelas só leitura para a tela, funções só pelo servidor.
-- conversations.state e crm_contacts.tags NÃO são alterados por nada desta parte.
-- ============================================================================
begin;

create table if not exists public.labels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 100),
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind        text not null check (kind in ('system','user')),
  system_key  text check (system_key in ('human','ai')),
  created_by  uuid references public.user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name),
  unique (company_id, system_key),
  check ((kind = 'system') = (system_key is not null))
);
create table if not exists public.contact_labels (
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  label_id   uuid not null references public.labels(id) on delete cascade,
  source     text not null default 'user' check (source in ('api','user','phone','system')),
  created_at timestamptz not null default now(),
  primary key (contact_id, label_id)
);
create table if not exists public.conversation_labels (
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id        uuid not null references public.labels(id) on delete cascade,
  source          text not null default 'user' check (source in ('api','user','phone','system')),
  created_at      timestamptz not null default now(),
  primary key (conversation_id, label_id)
);
create index if not exists contact_labels_label      on public.contact_labels (company_id, label_id);
create index if not exists conversation_labels_label on public.conversation_labels (company_id, label_id);

-- Só leitura para a tela (escrita: servidor e gatilhos)
alter table public.labels              enable row level security;
alter table public.contact_labels      enable row level security;
alter table public.conversation_labels enable row level security;
drop policy if exists tenant_read on public.labels;
drop policy if exists tenant_read on public.contact_labels;
drop policy if exists tenant_read on public.conversation_labels;
create policy tenant_read on public.labels              for select to authenticated using (company_id = public.get_my_company_id());
create policy tenant_read on public.contact_labels      for select to authenticated using (company_id = public.get_my_company_id());
create policy tenant_read on public.conversation_labels for select to authenticated using (company_id = public.get_my_company_id());

-- Conversa individual? (grupo, broadcast e canal não recebem etiqueta de sistema)
create or replace function public.is_individual_jid(p_jid text) returns boolean
language sql immutable as $$
  select p_jid is not null
     and p_jid not like '%@g.us' and p_jid not like '%@broadcast' and p_jid not like '%@newsletter';
$$;

create or replace function public.ensure_system_labels(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_company is null then return; end if;
  insert into public.labels (company_id, name, color, kind, system_key) values
    (p_company, 'Atendimento humano', '#f59e0b', 'system', 'human'),
    (p_company, 'Atendimento IA',     '#6366f1', 'system', 'ai')
  on conflict do nothing;
end $$;

-- Troca a etiqueta de sistema da conversa (exatamente uma). Uso interno.
create or replace function public._apply_attendance_label(p_conv uuid, p_company uuid, p_key text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare v_label uuid;
begin
  perform public.ensure_system_labels(p_company);
  select id into v_label from public.labels where company_id = p_company and system_key = p_key;
  delete from public.conversation_labels cl
   using public.labels l
   where cl.conversation_id = p_conv and cl.label_id = l.id
     and l.system_key is not null and l.system_key <> p_key;
  insert into public.conversation_labels (company_id, conversation_id, label_id, source)
  values (p_company, p_conv, v_label, coalesce(p_source,'system'))
  on conflict do nothing;
end $$;

-- ET-3 (servidor, com a chave labels ligada): estado + etiqueta juntos, numa transação.
-- Devolve true se o estado mudou. Grupo → erro.
create or replace function public.set_conversation_attendance(p_conv uuid, p_company uuid, p_key text, p_source text, p_actor uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c record; v_state text := case when p_key = 'human' then 'human' else 'automation' end;
begin
  if p_key not in ('human','ai') then raise exception 'attendance_key_invalida'; end if;
  select id, company_id, remote_jid, state into c from public.conversations
   where id = p_conv and company_id = p_company for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if not public.is_individual_jid(c.remote_jid) then raise exception 'unsupported_for_group'; end if;
  if c.state is distinct from v_state then
    update public.conversations
       set state = v_state, state_since = now(), state_by = p_actor, updated_at = now()
     where id = p_conv;
  end if;
  perform public._apply_attendance_label(p_conv, c.company_id, p_key, p_source);
  return c.state is distinct from v_state;
end $$;

-- Gatilho: conversa nova / estado mudado → etiqueta correspondente. NUNCA altera state e
-- NUNCA derruba a escrita da conversa (exception → warning nos logs do Postgres).
create or replace function public.trg_conversation_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.company_id is null or not public.is_individual_jid(new.remote_jid) then return null; end if;
  begin
    perform public._apply_attendance_label(new.id, new.company_id,
      case when new.state = 'human' then 'human' else 'ai' end, 'system');
  exception when others then
    raise warning '[labels] etiqueta de sistema não aplicada (conversa %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists conversation_attendance_ins on public.conversations;
create trigger conversation_attendance_ins after insert on public.conversations
  for each row execute function public.trg_conversation_attendance();
drop trigger if exists conversation_attendance_upd on public.conversations;
create trigger conversation_attendance_upd after update of state on public.conversations
  for each row when (old.state is distinct from new.state)
  execute function public.trg_conversation_attendance();

-- Tags do contato (fonte na Fase A) → contact_labels. Pula nomes que não cabem e nomes de
-- sistema; remove o que saiu do array. Uma direção só.
create or replace function public.sync_contact_labels(p_contact uuid, p_company uuid, p_tags text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_company is null then return; end if;
  if coalesce(current_setting('flowmate.skip_label_sync', true), '') = 'on' then return; end if;
  -- o contato precisa ser desta empresa (nunca cruza empresas)
  if not exists (select 1 from public.crm_contacts where id = p_contact and company_id = p_company) then return; end if;
  -- as de sistema existem antes de qualquer tag (uma tag com nome de sistema nunca as bloqueia)
  perform public.ensure_system_labels(p_company);
  insert into public.labels (company_id, name, kind)
  select distinct p_company, t, 'user'
    from unnest(array_remove(coalesce(p_tags, '{}'), null)) t
   where length(btrim(t)) between 1 and 100
     and t not in ('Atendimento humano', 'Atendimento IA')
  on conflict do nothing;
  delete from public.contact_labels cl
   using public.labels l
   where cl.contact_id = p_contact and cl.label_id = l.id and l.kind = 'user'
     and not (l.name = any (array_remove(coalesce(p_tags, '{}'), null)));
  insert into public.contact_labels (company_id, contact_id, label_id, source)
  select p_company, p_contact, l.id, 'system'
    from public.labels l
   where l.company_id = p_company and l.kind = 'user' and l.name = any (array_remove(coalesce(p_tags, '{}'), null))
  on conflict do nothing;
end $$;

create or replace function public.trg_contact_tags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  begin
    perform public.sync_contact_labels(new.id, new.company_id, new.tags);
  exception when others then
    raise warning '[labels] tags do contato % não sincronizadas: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists contact_tags_ins on public.crm_contacts;
create trigger contact_tags_ins after insert on public.crm_contacts
  for each row execute function public.trg_contact_tags();
drop trigger if exists contact_tags_upd on public.crm_contacts;
create trigger contact_tags_upd after update of tags on public.crm_contacts
  for each row when (old.tags is distinct from new.tags)
  execute function public.trg_contact_tags();

-- Empresa nova já nasce com as etiquetas de sistema
create or replace function public.trg_company_system_labels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.ensure_system_labels(new.id);
  exception when others then raise warning '[labels] etiquetas de sistema da empresa %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists company_system_labels on public.companies;
create trigger company_system_labels after insert on public.companies
  for each row execute function public.trg_company_system_labels();

-- ET-2 (servidor): renomear / excluir etiqueta de usuário, mantendo os arrays de tags.
create or replace function public.rename_label(p_label uuid, p_company uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_kind text;
begin
  select name, kind into v_old, v_kind from public.labels where id = p_label and company_id = p_company for update;
  if not found then raise exception 'label_not_found'; end if;
  if v_kind = 'system' then raise exception 'label_is_system'; end if;
  update public.labels set name = p_name, updated_at = now() where id = p_label;
  perform set_config('flowmate.skip_label_sync', 'on', true);
  update public.crm_contacts set tags = array_replace(tags, v_old, p_name)
   where company_id = p_company and v_old = any (tags);
  perform set_config('flowmate.skip_label_sync', '', true);
end $$;

create or replace function public.delete_label(p_label uuid, p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_kind text;
begin
  select name, kind into v_name, v_kind from public.labels where id = p_label and company_id = p_company for update;
  if not found then raise exception 'label_not_found'; end if;
  if v_kind = 'system' then raise exception 'label_is_system'; end if;
  perform set_config('flowmate.skip_label_sync', 'on', true);
  update public.crm_contacts set tags = array_remove(tags, v_name)
   where company_id = p_company and v_name = any (tags);
  perform set_config('flowmate.skip_label_sync', '', true);
  delete from public.labels where id = p_label;     -- cascata: contact_labels/conversation_labels
end $$;

-- Só o servidor chama as funções
revoke execute on function public.ensure_system_labels(uuid)                         from public, anon, authenticated;
revoke execute on function public._apply_attendance_label(uuid, uuid, text, text)    from public, anon, authenticated;
revoke execute on function public.set_conversation_attendance(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.sync_contact_labels(uuid, uuid, text[])            from public, anon, authenticated;
revoke execute on function public.rename_label(uuid, uuid, text)                     from public, anon, authenticated;
revoke execute on function public.delete_label(uuid, uuid)                           from public, anon, authenticated;
grant execute on function public.ensure_system_labels(uuid), public._apply_attendance_label(uuid, uuid, text, text),
  public.set_conversation_attendance(uuid, uuid, text, text, uuid), public.sync_contact_labels(uuid, uuid, text[]),
  public.rename_label(uuid, uuid, text), public.delete_label(uuid, uuid) to service_role;

-- ── Backfill e migração (sem alterar conversations.state nem crm_contacts.tags) ──
select public.ensure_system_labels(id) from public.companies;

insert into public.conversation_labels (company_id, conversation_id, label_id, source)
select c.company_id, c.id, l.id, 'system'
  from public.conversations c
  join public.labels l
    on l.company_id = c.company_id
   and l.system_key = case when c.state = 'human' then 'human' else 'ai' end
 where c.company_id is not null and public.is_individual_jid(c.remote_jid)
on conflict do nothing;

select public.sync_contact_labels(id, company_id, tags)
  from public.crm_contacts
 where company_id is not null and coalesce(array_length(tags, 1), 0) > 0;

commit;


-- ============================================================================
-- PARTE 7 — A3: agendador (rode SÓ depois de eu avisar que a rota /api/whatsapp/jobs
-- está no ar e de você criar JOBS_SECRET na Vercel — Production — com o MESMO valor
-- que vai no Vault abaixo). Sem isso, não rode esta parte.
-- ============================================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- (o segredo colado fica no histórico/snippets do SQL Editor: apague o snippet depois)
-- do $vault$ begin
--   if exists (select 1 from vault.secrets where name = 'flowmate_jobs_secret') then
--     perform vault.update_secret((select id from vault.secrets where name = 'flowmate_jobs_secret'), 'COLE_AQUI_O_JOBS_SECRET');
--   else
--     perform vault.create_secret('COLE_AQUI_O_JOBS_SECRET', 'flowmate_jobs_secret');
--   end if;
-- end $vault$;
-- select cron.schedule('flowmate-jobs', '* * * * *', $job$
--   select net.http_post(
--     url := 'https://flowmate-ashy.vercel.app/api/whatsapp/jobs',
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'flowmate_jobs_secret')),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 25000);
-- $job$);
-- Conferir: select jobid, schedule, active from cron.job where jobname = 'flowmate-jobs';
--           select status_code, created from net._http_response order by created desc limit 5;


-- ============================================================================
-- PARTE 8 — conferências DEPOIS (só leitura). Me mande os resultados.
-- ============================================================================
-- 8.1 Política de companies: deve existir só "tenant_read" (SELECT)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'companies';

-- 8.2 Tabelas novas existem e têm RLS ligado (7 linhas, todas true)
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('inbound_events','line_sync_state','ops_alerts','outbound_messages',
                   'labels','contact_labels','conversation_labels');

-- 8.3 Empresas sem exatamente 2 etiquetas de sistema (esperado: 0)
select count(*) as empresas_com_problema from public.companies c
 where (select count(*) from public.labels l where l.company_id = c.id and l.kind = 'system') <> 2;

-- 8.4 Conversa individual (de empresa existente) sem etiqueta de sistema, ou com as duas
--     (esperado: 0 e 0)
select count(*) filter (where n = 0) as sem_etiqueta, count(*) filter (where n > 1) as com_duas
  from (select c.id, (select count(*) from public.conversation_labels cl join public.labels l on l.id = cl.label_id
                       where cl.conversation_id = c.id and l.kind = 'system') as n
          from public.conversations c
         where c.company_id is not null and public.is_individual_jid(c.remote_jid)
           and exists (select 1 from public.companies co where co.id = c.company_id)) x;

-- 8.5 Etiqueta "humano" bate com state = 'human' (esperado: as duas colunas iguais)
select (select count(*) from public.conversations c
         where c.state = 'human' and public.is_individual_jid(c.remote_jid) and c.company_id is not null
           and exists (select 1 from public.companies co where co.id = c.company_id)) as state_human,
       (select count(*) from public.conversation_labels cl join public.labels l on l.id = cl.label_id
         where l.system_key = 'human') as etiqueta_humano;

-- 8.6 Grupos com etiqueta de sistema (esperado: 0)
select count(*) as grupos_com_etiqueta_de_sistema from public.conversation_labels cl
  join public.conversations c on c.id = cl.conversation_id
  join public.labels l on l.id = cl.label_id
 where l.kind = 'system' and not public.is_individual_jid(c.remote_jid);

-- 8.7 Tags × etiquetas, nos dois sentidos (esperado: 0 e 0; tags puladas da 0.5 não contam)
select (select count(*) from public.crm_contacts c, unnest(array_remove(coalesce(c.tags,'{}'), null)) t
         where c.company_id is not null
           and length(btrim(t)) between 1 and 100 and t not in ('Atendimento humano','Atendimento IA')
           and not exists (select 1 from public.contact_labels cl join public.labels l on l.id = cl.label_id
                            where cl.contact_id = c.id and l.name = t)) as tag_sem_etiqueta,
       (select count(*) from public.contact_labels cl join public.labels l on l.id = cl.label_id
          join public.crm_contacts c on c.id = cl.contact_id
         where l.kind = 'user' and not (l.name = any (coalesce(c.tags,'{}')))) as etiqueta_sem_tag;

-- 8.8 Índices únicos criados (esperado: 2 linhas)
select indexname from pg_indexes
 where indexname in ('whatsapp_messages_company_message_uniq', 'inbound_events_dedup');

-- 8.9 Nenhuma empresa com chave ligada (esperado: 0)
select count(*) as empresas_com_chave_ligada from public.companies where features <> '{}'::jsonb;

-- 8.10 A tela NÃO pode executar as funções (esperado: tudo false)
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as tela_pode
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('claim_inbound_events','ensure_system_labels','_apply_attendance_label',
                     'set_conversation_attendance','sync_contact_labels','rename_label','delete_label');

-- 8.11 Gatilhos criados (esperado: 5 linhas)
select tgname from pg_trigger
 where tgname in ('conversation_attendance_ins','conversation_attendance_upd',
                  'contact_tags_ins','contact_tags_upd','company_system_labels');

-- ============================================================================
-- ROLLBACK (comentado; rode só a parte que precisar desfazer)
-- ============================================================================
-- PARTE 7: select cron.unschedule('flowmate-jobs'); delete from vault.secrets where name = 'flowmate_jobs_secret';
-- PARTE 6:
--   drop trigger if exists company_system_labels on public.companies;
--   drop trigger if exists contact_tags_ins on public.crm_contacts;
--   drop trigger if exists contact_tags_upd on public.crm_contacts;
--   drop trigger if exists conversation_attendance_ins on public.conversations;
--   drop trigger if exists conversation_attendance_upd on public.conversations;
--   drop function if exists public.trg_company_system_labels(), public.trg_contact_tags(),
--     public.trg_conversation_attendance(), public.sync_contact_labels(uuid,uuid,text[]),
--     public.rename_label(uuid,uuid,text), public.delete_label(uuid,uuid),
--     public.set_conversation_attendance(uuid,uuid,text,text,uuid),
--     public._apply_attendance_label(uuid,uuid,text,text), public.ensure_system_labels(uuid),
--     public.is_individual_jid(text);
--   drop table if exists public.conversation_labels, public.contact_labels, public.labels;
--   (conversations.state e crm_contacts.tags nunca foram alterados: nada se perde.)
-- PARTE 5: drop table if exists public.outbound_messages;
-- PARTE 4: drop table if exists public.ops_alerts, public.line_sync_state;
-- PARTE 3: drop index if exists public.whatsapp_messages_company_message_uniq;
-- PARTE 2: drop function if exists public.claim_inbound_events(int); drop table if exists public.inbound_events;
-- PARTE 1 (volta a política antiga — reabre o buraco, só em emergência):
--   drop policy if exists tenant_read on public.companies;
--   create policy tenant_isolation on public.companies for all to authenticated
--     using (id = public.get_my_company_id()) with check (id = public.get_my_company_id());
--   alter table public.companies drop column if exists features;
