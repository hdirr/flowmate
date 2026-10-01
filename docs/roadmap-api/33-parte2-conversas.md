# 33 — Parte 2, bloco 5: conversas completas (DESENHO)

> Não implementar sem liberação do Agadir. Ver `30-parte2-visao.md`.

## Problema
A conversa no FlowMate só tem `state` (`automation`/`human`). Não tem dono, não encerra, não
tem fila. Na Helena (e no IVE CRM, revisado em 01/10/2026) a conversa tem status, responsável,
equipe, encerramento com classificação, e a tela de atendimento é organizada em filas
**Novos / Meus / Outros**.

## Dois eixos que não se misturam
- **`state`** (já existe): quem responde — `automation` (bot/n8n) ou `human`. Continua sendo a
  regra do 409.
- **`status`** (novo): onde a conversa está no atendimento — `pending` (ninguém pegou),
  `in_progress` (tem responsável), `closed` (encerrada).

Exemplo: conversa `automation` + `pending` = o bot está atendendo e ninguém da equipe pegou.
Atendente pega → `in_progress` + responsável; ao digitar, vira `human` (regra atual).

## Modelo de dados (fase A)
```sql
alter table public.conversations
  add column if not exists status              text not null default 'pending'
                                               check (status in ('pending','in_progress','closed')),
  add column if not exists assigned_user_id    uuid references public.user_profiles(id) on delete set null,
  add column if not exists team_id             uuid,            -- bloco 6
  add column if not exists bot_id              uuid,            -- bloco 12
  add column if not exists closed_at           timestamptz,
  add column if not exists close_category      text check (close_category in ('won','lost','info','other')),
  add column if not exists close_amount        numeric(14,2),
  add column if not exists close_note          text,
  add column if not exists reopen_mode         text check (reopen_mode in ('automation','same_user')),
  add column if not exists first_response_at   timestamptz,
  add column if not exists last_message_in_at  timestamptz,
  add column if not exists last_message_out_at timestamptz,
  add column if not exists unread_count        integer not null default 0;

create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid, text text not null, created_at timestamptz not null default now()
);
```
Preenchimento inicial: conversas com mensagem nos últimos 7 dias → `pending`; o resto → `closed`.

## Métricas sem mexer no webhook do WhatsApp
Um `trigger after insert` em `whatsapp_messages` (só conversas 1:1) atualiza:
- mensagem do cliente → `last_message_in_at`, `unread_count + 1`; se a conversa estava `closed`,
  reabre conforme `reopen_mode` (`automation`: `status='pending'`, `state='automation'`,
  `assigned_user_id=null`; `same_user`: `status='in_progress'`, mantém o responsável).
- mensagem nossa → `last_message_out_at`; se `first_response_at` é nulo e `sender='human'`,
  preenche.
`handleWebhook` **não muda**. Abrir a conversa na tela zera `unread_count`.

## Comportamento
| Ação | Efeito |
| --- | --- |
| Pegar conversa (tela) | `status=in_progress`, `assigned_user_id=eu` |
| Transferir para usuário | troca `assigned_user_id`; opção "parar o bot" (`state=human`) |
| Encerrar | `status=closed`, `closed_at`, classificação, valor, nota, `reopen_mode` |
| Cliente escreve depois de encerrada | reabre conforme `reopen_mode` (trigger) |

## Tela (`src/pages/Chats.jsx`)
- Abas **Novos** (`pending`), **Meus** (`assigned_user_id = eu`, não encerradas), **Outros**
  (dos outros), **Encerradas**; filtro "não lidas".
- Cabeçalho da conversa: responsável, botões Pegar / Transferir / Encerrar; selo do estado
  (já existe) e do bot ativo.
- Notas internas da conversa (não vão para o cliente).
- Visibilidade do vendedor: depende da decisão em aberto.

## API
- `GET /v1/conversations` ganha filtros `status`, `assignedUserId`, `unreadOnly`.
- `POST /v1/conversations/{id}/assign` `{ user_id, stop_bot }`.
- `POST /v1/conversations/{id}/transfer` `{ type: 'user'|'team', user_id, team_id, stop_bot }`.
- `POST /v1/conversations/{id}/close` `{ category, amount, note, reopen_mode, stop_bot }`.
- `POST /v1/conversations/{id}/reopen`.
- `GET/POST /v1/conversations/{id}/notes`.
- Eventos: `conversation.created`, `conversation.assigned`, `conversation.closed`,
  `conversation.reopened` (todos via outbox, bloco 4).

## Riscos
- O Chats é a tela mais usada; mudar as abas confunde → liberar pela chave por empresa.
- RLS de `conversations`: hoje não há política de cliente (só servidor). Se a tela passar a ler
  direto, criar política por empresa (e por responsável, conforme a decisão de visibilidade).
- `unread_count` errado se o trigger falhar → recalcular sob demanda numa rota de manutenção.

## Aceite
Cliente novo escreve → aparece em Novos; atendente pega → vai para Meus; encerra como ganho com
valor; cliente escreve de novo → reabre conforme o modo; tudo também pela API e com os eventos.
