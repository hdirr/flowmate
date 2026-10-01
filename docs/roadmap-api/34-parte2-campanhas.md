# 34 — Parte 2, bloco 15: campanhas (DESENHO)

> Não implementar sem liberação do Agadir. Ver `30-parte2-visao.md`.

## Por que existe
No IVE CRM (Helena) o Agadir dispara campanhas de prospecção quase todo dia (8 entre 18/09 e
01/10/2026, de 5 a 127 destinatários). A API da Helena **não** tem campanhas; é recurso de tela.
O FlowMate hoje só tem "Executar agora" por etapa nas automações, que roda no navegador.

## Risco principal: bloqueio do número
O FlowMate conecta por QR (Evolution/Baileys), não pela API oficial. Envio em massa rápido, para
quem não tem o número salvo, é o caminho mais curto para o WhatsApp bloquear o número. Por isso
campanha **nasce com freio**: ritmo baixo por padrão, intervalo aleatório entre envios, janela de
horário, limite diário, parada automática se a conexão cair ou se muitos envios falharem.

## Modelo de dados
```sql
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','processing','paused','completed','canceled','failed')),
  template_id uuid,                    -- bloco 9 (ou content + media)
  content text, media jsonb,
  audience jsonb not null default '{}',-- filtro: pipeline/etapa/tags/sem conversa há X dias, ou lista de ids
  scheduled_at timestamptz,
  per_minute integer not null default 6,      -- ritmo (decisão em aberto)
  min_delay_s integer not null default 6, max_delay_s integer not null default 15,
  window_start time, window_end time,         -- horário permitido
  daily_cap integer,
  skip_human boolean not null default true,   -- pula conversa em atendimento humano
  stop_on_error_rate numeric(4,2) default 0.20,
  created_by uuid, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz
);
create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  company_id uuid not null,
  contact_id uuid, phone text not null,
  status text not null default 'pending'
    check (status in ('pending','sent','delivered','read','replied','failed','skipped')),
  message_id text, error text, sent_at timestamptz, updated_at timestamptz
);
create index on public.campaign_recipients (campaign_id, status);
```
Limpeza: destinatários de campanhas concluídas há mais de 90 dias (mantém os números agregados
em `campaigns`).

## Execução (usa o bloco 4)
1. Ao agendar/iniciar: congela a lista de destinatários (`campaign_recipients`), remove
   duplicados e contatos com tag de descadastro (ex.: `nao-perturbe`).
2. Cada tick (1 min) pega até `per_minute` destinatários pendentes **da campanha** e cria envios
   espaçados (`min_delay_s`..`max_delay_s`); fora da janela, não envia.
3. Envio sempre por `sendMessage` (`sender='automation'`); `skip_human` respeita o 409.
4. Para sozinha se: número desconectado (`whatsapp.connection`), taxa de falha acima do limite,
   ou limite diário atingido (retoma no dia seguinte).
5. Status `delivered`/`read` vêm do bloco 7; `replied` = chegou mensagem do contato depois do envio
   (trigger em `whatsapp_messages`).

## Tela
Lista (nome, data, destinatários, status, relatório), criar/editar rascunho com seleção de
público e prévia da contagem, agendar, pausar, retomar, cancelar, duplicar ("Cópia de...",
como a Helena). Relatório: enviados, entregues, lidos, responderam, falhas (com motivo).

## API (opcional, depois da tela)
`GET/POST /v1/campaigns`, `POST /v1/campaigns/{id}/start|pause|cancel`,
`GET /v1/campaigns/{id}/recipients`. Eventos `campaign.completed`, `campaign.failed`.

## Infra
- Volume de mensagens aumenta: monitorar o volume de 5 GB do Railway (Evolution) e o tamanho do
  banco no Supabase.
- Tempo de função da Vercel: cada tick envia pouco (ritmo baixo), cabe com folga.

## Aceite
Campanha de teste para 5 contatos de teste, ritmo 2/min, janela atual: envia espaçado, relatório
fecha com os números certos; pausar no meio para os envios; desconectar o número para a campanha.
