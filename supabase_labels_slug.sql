-- ============================================================================
-- FlowMate — nome padronizado (slug) das etiquetas JÁ GRAVADAS (2026-10-19)
-- Pedido: "nome padronizado em toda criação e edição". O código novo já grava slug (com a
-- chave labels ligada). Este arquivo normaliza o que JÁ existe: etiquetas de usuário e os
-- arrays crm_contacts.tags (a fonte das etiquetas de contato na Fase A).
--
-- A empresa do Agadir: NADA a migrar (conferido pela /v1 em 2026-10-19: a única etiqueta de
-- usuário já está no padrão). Este arquivo é para as OUTRAS empresas, antes de ligar a chave
-- labels nelas.
--
-- ORDEM:
--   PARTE 0  conferência (SÓ LEITURA de dados; antes, cria só a função auxiliar label_slug)
--            → me mande o resultado de cada consulta
--   PARTE 1  migração (só depois de olharmos a PARTE 0 juntos)
--   PARTE 2  conferência depois (SÓ LEITURA)
--   ROLLBACK no fim (comentado)
-- O SQL Editor mostra só o resultado da ÚLTIMA consulta: rode uma de cada vez.
-- Etiquetas de SISTEMA ("Atendimento humano"/"Atendimento IA") não são tocadas, nem tags com
-- esses nomes exatos no array de um contato (ficam como estão; o gatilho já as pula).
-- Nada aqui mostra dado de contato: só nomes de etiqueta e contagens.
-- ============================================================================

-- Regra do slug (igual a api/_lib/labelName.js): minúsculas, sem acento, fora de a-z/0-9 vira
-- hífen, sem hífen repetido nem nas pontas. (O JS tira qualquer acento; aqui a lista cobre o
-- português/espanhol. Letra fora da lista vira hífen — a PARTE 0 mostra o resultado.)
create or replace function public.label_slug(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑýÿÝ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnNyyY')), '[^a-z0-9]+', '-', 'g'), '-');
$$;


-- ============================================================================
-- PARTE 0 — conferência ANTES (só leitura)
-- ============================================================================

-- 0.1 Etiquetas de usuário que MUDAM de nome (empresa = 8 primeiros caracteres do id)
select left(l.company_id::text, 8) as empresa, l.name as nome_atual, public.label_slug(l.name) as nome_novo,
       (select count(*) from public.contact_labels cl where cl.label_id = l.id)      as contatos,
       (select count(*) from public.conversation_labels vl where vl.label_id = l.id) as conversas
  from public.labels l
 where l.kind = 'user' and l.name <> public.label_slug(l.name)
 order by 1, 2;

-- 0.2 COLISÕES: mais de uma etiqueta vira o mesmo slug (na migração viram uma só)
select left(company_id::text, 8) as empresa, public.label_slug(name) as nome_novo,
       array_agg(name order by created_at, id) as etiquetas_que_se_juntam, count(*) as quantas
  from public.labels
 where kind = 'user'
 group by company_id, public.label_slug(name)
having count(*) > 1
 order by 1, 2;

-- 0.3 Etiquetas cujo slug fica VAZIO (ex.: só símbolos) — a migração NÃO mexe nelas
select left(company_id::text, 8) as empresa, name
  from public.labels where kind = 'user' and public.label_slug(name) = '';

-- 0.4 Contatos cujo array de tags muda, por empresa (só a contagem)
select left(company_id::text, 8) as empresa, count(*) as contatos_com_tags_alteradas
  from public.crm_contacts c
 where coalesce(array_length(c.tags, 1), 0) > 0
   and exists (select 1 from unnest(c.tags) t where public.label_slug(t) <> '' and t <> public.label_slug(t) and t not in ('Atendimento humano', 'Atendimento IA'))
 group by 1 order by 1;

-- 0.5 Resumo
select (select count(*) from public.labels where kind = 'user')                                        as etiquetas_usuario,
       (select count(*) from public.labels where kind = 'user' and name <> public.label_slug(name))    as mudam_de_nome,
       (select count(*) from (select 1 from public.labels where kind = 'user'
                               group by company_id, public.label_slug(name) having count(*) > 1) x)    as grupos_de_colisao,
       (select count(*) from public.labels where kind = 'user' and public.label_slug(name) = '')       as slug_vazio;


-- ============================================================================
-- PARTE 1 — migração (só depois de olharmos a PARTE 0). Uma transação.
-- Colisão: fica a etiqueta que já tem o nome do slug; senão a mais antiga. As outras são
-- apagadas, e as conversas delas passam para a que fica. A cor da que fica é mantida.
-- Arrays de tags: cada tag vira o slug, sem repetir (ordem mantida); tag com slug vazio fica
-- como está. O gatilho de tags religa contact_labels sozinho.
-- ============================================================================
begin;

-- cópias para o rollback. Se já existem (a PARTE 1 já rodou), PARA aqui: rodar de novo
-- refaria as cópias com os dados já migrados e o ROLLBACK perderia o que restaurar.
do $ begin
  if to_regclass('public._slug_bak_labels') is not null then
    raise exception 'As cópias _slug_bak_* já existem: a PARTE 1 já rodou. Confira a PARTE 2; para rodar de novo, apague as cópias antes (perde o rollback).';
  end if;
end $;
create table public._slug_bak_labels as
  select * from public.labels where kind = 'user';
create table public._slug_bak_conv_labels as
  select vl.* from public.conversation_labels vl join public.labels l on l.id = vl.label_id where l.kind = 'user';
create table public._slug_bak_contact_tags as
  select id, company_id, tags from public.crm_contacts c
   where exists (select 1 from unnest(c.tags) t where public.label_slug(t) <> '' and t <> public.label_slug(t) and t not in ('Atendimento humano', 'Atendimento IA'));
-- só o servidor lê (RLS sem política = ninguém pela tela)
alter table public._slug_bak_labels       enable row level security;
alter table public._slug_bak_conv_labels  enable row level security;
alter table public._slug_bak_contact_tags enable row level security;

-- quem fica em cada (empresa, slug)
create temp table _slug_map on commit drop as
select l.id as old_id, l.company_id, public.label_slug(l.name) as slug,
       first_value(l.id) over (partition by l.company_id, public.label_slug(l.name)
         order by (l.name = public.label_slug(l.name)) desc, l.created_at, l.id) as target_id
  from public.labels l
 where l.kind = 'user' and public.label_slug(l.name) <> '';

-- conversas das que saem → a que fica
insert into public.conversation_labels (company_id, conversation_id, label_id, source, created_at)
select vl.company_id, vl.conversation_id, m.target_id, vl.source, vl.created_at
  from public.conversation_labels vl join _slug_map m on m.old_id = vl.label_id
 where m.old_id <> m.target_id
on conflict do nothing;

-- apaga as que saem (cascata: contact_labels/conversation_labels delas)
delete from public.labels l using _slug_map m where l.id = m.old_id and m.old_id <> m.target_id;

-- renomeia as que ficam
update public.labels l set name = m.slug, updated_at = now()
  from _slug_map m where l.id = m.target_id and m.old_id = m.target_id and l.name <> m.slug;

-- arrays de tags (o gatilho contact_tags_upd sincroniza contact_labels)
update public.crm_contacts c
   set tags = x.novas
  from (
    select b.id, array_agg(s order by ord) as novas
      from (select c2.id, s, min(ord) as ord
              from public.crm_contacts c2,
                   lateral unnest(c2.tags) with ordinality as u(t, ord),
                   lateral (select case when public.label_slug(u.t) = '' or u.t in ('Atendimento humano', 'Atendimento IA') then u.t else public.label_slug(u.t) end as s) z
             where c2.id in (select id from public._slug_bak_contact_tags)
             group by c2.id, s) b
     group by b.id
  ) x
 where c.id = x.id and c.tags is distinct from x.novas;

commit;


-- ============================================================================
-- PARTE 2 — conferência DEPOIS (só leitura). Esperado: 0, 0, 0.
-- ============================================================================
select (select count(*) from public.labels where kind = 'user' and public.label_slug(name) <> '' and name <> public.label_slug(name)) as fora_do_padrao,
       (select count(*) from (select 1 from public.labels where kind = 'user'
                               group by company_id, name having count(*) > 1) x)                                               as nomes_repetidos,
       (select count(*) from public.crm_contacts c
         where exists (select 1 from unnest(c.tags) t where public.label_slug(t) <> '' and t <> public.label_slug(t) and t not in ('Atendimento humano', 'Atendimento IA'))) as contatos_com_tag_fora_do_padrao;
-- e: contatos cujas etiquetas de usuário ≠ tags (esperado 0)
select count(*) as contatos_dessincronizados
  from public.crm_contacts c
 where coalesce((select array_agg(l.name order by l.name) from public.contact_labels cl join public.labels l on l.id = cl.label_id
                  where cl.contact_id = c.id and l.kind = 'user'), '{}')
    <> coalesce((select array_agg(distinct t order by t) from unnest(c.tags) t
                  where length(btrim(t)) between 1 and 100 and t not in ('Atendimento humano', 'Atendimento IA')), '{}');
-- Depois de conferir, as cópias podem sair:
-- drop table public._slug_bak_labels, public._slug_bak_conv_labels, public._slug_bak_contact_tags;


-- ============================================================================
-- ROLLBACK (só se a PARTE 1 rodou e precisar voltar). Usa as cópias _slug_bak_*.
-- ============================================================================
-- begin;
-- -- 1) nomes e cores das que ficaram
-- update public.labels l set name = b.name, color = b.color, updated_at = b.updated_at
--   from public._slug_bak_labels b where l.id = b.id;
-- -- 2) recria as que foram apagadas na junção
-- insert into public.labels select * from public._slug_bak_labels b
--  where not exists (select 1 from public.labels l where l.id = b.id) on conflict do nothing;
-- -- 3) etiquetas de conversa como eram (tira as copiadas na junção e devolve as originais;
--    etiquetas de usuário aplicadas em conversa DEPOIS da migração também saem)
-- delete from public.conversation_labels vl using public.labels l
--  where l.id = vl.label_id and l.kind = 'user'
--    and not exists (select 1 from public._slug_bak_conv_labels b where b.conversation_id = vl.conversation_id and b.label_id = vl.label_id);
-- insert into public.conversation_labels select * from public._slug_bak_conv_labels on conflict do nothing;
-- -- 4) arrays de tags como eram (o gatilho religa contact_labels)
-- update public.crm_contacts c set tags = b.tags from public._slug_bak_contact_tags b where c.id = b.id;
-- commit;
-- -- a função label_slug pode ficar (não é usada por nada) ou: drop function public.label_slug(text);
