# FlowMate — Estado do Projeto (Handoff)

> Documento vivo pra retomar o projeto em sessão nova, com contexto zerado.
> **Sem segredos aqui** — chaves ficam nas env vars do Vercel / painéis.
> Última atualização: 2026-07-17.
>
> **PRÓXIMO OBJETIVO (a fazer):** criar uma **integração para equipe de marketing** dentro do produto
> (o usuário quer "incorporar" isso ao FlowMate). Ainda não especificado — levantar requisitos primeiro.

## O que é
FlowMate — **CRM de WhatsApp com automação**, vendido como SaaS pelo Agadir direto ao cliente final.
Produção: **https://flowmate-ashy.vercel.app**

## Stack e infra
- **Frontend:** React + Vite + Tailwind (`src/`). Deploy estático no Vercel.
- **Backend:** funções serverless do Vercel em `api/*` (Node). Usam `service_role` do Supabase.
- **Banco/Auth:** Supabase (projeto `fwtnzxehfaqeklueojkp`). Multi-tenant por `company_id` (company = tenant).
- **WhatsApp:** Evolution API self-hosted no **Railway** (`evolution-api-production-3a96.up.railway.app`). Uma instância por empresa: `flowmate-{company_id}`.
- **Pagamento:** **Asaas** (hoje em **sandbox**). Checkout hospedado + webhook.
- **Repo:** `github.com/hdirr/flowmate` (público), branch `main`, auto-deploy no push.
  - Push: `git push https://hdirr:<PAT>@github.com/hdirr/flowmate.git main`

### Proxy Supabase (importante)
O provedor do Agadir bloqueia o TLD `.co`, então TODAS as chamadas Supabase passam por `/sb-proxy` (rewrite no `vercel.json`). Por isso o **Realtime (WebSocket) foi desativado** — usa-se **polling**. Solução definitiva futura: domínio próprio pro Supabase.

## Limite crítico: Vercel Hobby = 12 serverless functions (ESTAMOS EM 12/12)
Não crie novos arquivos em `api/` sem consolidar. Rotas novas vão em catch-alls (`[...path].js`).
Funções atuais: `users`, `public/lead`, `conversations/state`, `integrations/emit`, `v1/[...path]`, `billing/[...path]`, `whatsapp/{connect,send,send-media,status,sync,webhook}`.
Compartilhados (não contam): `api/_lib/{db,conversations,sendMessage,webhooks,plans,v1handlers}.js`.

## Env vars no Vercel (nomes; valores só no painel)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `APP_URL`, `WEBHOOK_SECRET` (opcional),
`ASAAS_API_KEY`, `ASAAS_API_URL` (hoje sandbox), `ASAAS_WEBHOOK_TOKEN`.

---

## Funcionalidades PRONTAS (no ar)
- **CRM:** Contatos (seleção múltipla), Pipeline **multi-funil** com acesso por usuário, campos personalizados, notas, tags, Dashboard com métricas por funil, Importar.
- **WhatsApp:** conexão por QR (Configurações), Chats (só contatos do CRM), envio/recebimento, **anexos (foto/vídeo/PDF)** via Supabase Storage (bucket `whatsapp-media`), botão "Chat" em Contatos/Pipeline, editar contato dentro do Chat.
- **Estado de conversa `automation | human`** com **enforcement 409** no ponto de saída (`api/_lib/sendMessage.js`). Badge + botão "devolver p/ automação" no Chat. Detecta resposta pelo celular (fromMe desconhecido → human). **Validado em produção.**
- **API de consumidor `/v1`** (a "boca e mãos" do n8n): `POST /v1/messages` (409 se human), `POST /v1/leads` (idempotente por `external_id`), `GET /v1/fields`, `GET/PATCH /v1/contacts` (escreve campos por id ou nome, tags, move etapa/funil), `GET /v1/messages` (histórico), `POST /v1/notes`. Auth por `x-api-key` (company_integrations.api_key).
- **Webhooks de saída** assinados (HMAC-SHA256 sobre `${ts}.${rawBody}`, header `X-Flowmate-Signature`), com `event_id` no payload. Eventos: `message.received` (só quando automation), `message.sent`, `contact.created`, `lead.created`, `lead.moved`. Config em Configurações → Integrações.
- **Automações:** gatilhos (lead_entered_stage, lead_moved_stage, contact_created, tag_added, lead_lost) + ações (WhatsApp real com mídia, mover etapa cross-funil, nota, tag, prioridade, campo, webhook, alert_overdue). "Executar agora" em massa por etapa.
- **Landing pública** (`src/pages/Landing.jsx`) + **fluxo pagamento-primeiro** (ver abaixo).
- **Doc pública de integração:** `INTEGRATIONS.md` (webhook + /v1 + regras pro n8n).

## Fluxo de venda: PAGAMENTO-PRIMEIRO (implementado)
```
Landing → "Assinar {nível}"
  → /assinar (Checkout: nome + email + CPF)          src/pages/Checkout.jsx
  → POST /api/billing/start (cria cliente+assinatura Asaas, grava pending_signups)
  → checkout hospedado da Asaas (aba nova) → cliente paga
  → Asaas → POST /api/billing/webhook (valida token) → pending_signups.status='paid'
  → /ativar (poll status; quando paid: nome empresa + nome + senha)   src/pages/Activate.jsx
  → POST /api/billing/activate → cria usuário (email_confirm:true, SEM link) + empresa (register_company) + plano ACTIVE
  → login automático → dashboard, já cria leads
```
- **Trava de acesso** (`App.jsx`): `subscription_status` da empresa precisa ser `active`, senão mostra `src/pages/Billing.jsx`. Empresas antigas foram "grandfatheradas" para `active`. A trava **falha-aberto** quando o status é desconhecido (pré-migração), pra não trancar ninguém por engano.
- **Preço autoritativo no servidor:** `api/_lib/plans.js` (nunca confia no cliente). Só **Faixa 1 (t1)** à venda.

## Migrações SQL já rodadas no Supabase
- `crm_pipelines` + `pipeline_id` em `crm_stages`/`crm_leads` (multi-funil)
- `conversations` (state automation|human) + `conversation_id`/`sender` em `whatsapp_messages`
- `crm_contacts.external_id` (idempotência)
- `company_integrations` (+ `webhook_secret`)
- `companies`: `subscription_status, plan_level, plan_tier, plan_cycle, line_cap, asaas_customer_id, asaas_subscription_id, current_period_end`
- `pending_signups`
- `whatsapp_instances`, `whatsapp_messages` (+ `media_url`, `file_name`, `message_id`)

---

## RUNBOOK — onboarding manual de um cliente (empresa)
Usado quando o cliente **não** passa pelo fluxo de pagamento (ex: parceria, cobrança offline).
Feito no **Supabase** (dashboard + SQL Editor). Claude não tem `service_role` nas ferramentas, então
**quem executa é o Agadir**. Conectar o WhatsApp exige escanear QR com o celular da clínica.

```sql
-- 1) Criar o login: Supabase > Authentication > Users > Add user (marcar "Auto Confirm User"). Copiar o UUID.

-- 2) Criar a empresa
select register_company('<Nome da Empresa>', '<UUID_DO_DONO>', '<Nome do Dono>');

-- 3) Descobrir o company_id
select company_id from user_profiles where id = '<UUID_DO_DONO>';

-- 4) Ativar assinatura + plano (Pro libera API/webhooks — necessário se usa agente externo)
update companies set
  subscription_status = 'active',
  plan_level = 'pro', plan_tier = 't1', plan_cycle = 'mensal', line_cap = 5
where id = '<COMPANY_ID>';

-- 5) Criar/atualizar integração (gera api_key e webhook_secret automaticamente)
insert into company_integrations (company_id, webhook_url, webhook_events, enabled)
values ('<COMPANY_ID>', '<URL_DO_WEBHOOK_DO_CLIENTE>', array['message.received'], true)
on conflict (company_id) do update set
  webhook_url = excluded.webhook_url, webhook_events = excluded.webhook_events, enabled = true;

-- 6) Pegar as credenciais pra entregar ao cliente
select company_id, api_key, webhook_secret from company_integrations where company_id = '<COMPANY_ID>';
```
7) **WhatsApp:** o dono loga no FlowMate → Configurações → WhatsApp → Conectar → escaneia o QR.

### Cliente em andamento
- **Clínica do Rafael** (parceria **Atimos**): atendida por **agente de IA externo** via n8n em
  `https://n8n.atimosbrasil.com/webhook/flowmate`, assinando **só `message.received`**.
  Fluxo: webhook assinado → n8n → agente → responde via `POST /v1/messages` (respeita o 409 se humano assumir).

## PENDÊNCIAS / PRÓXIMOS PASSOS
1. **Ir pra produção no Asaas:** hoje é sandbox. Trocar `ASAAS_API_URL` → `https://api.asaas.com/v3` + chave de produção. Configurar branding no Asaas (**Nome fantasia = FlowMate** + logo) pra sumir o nome pessoal/CNPJ do checkout.
2. **Ligar preço público:** `src/lib/pricing.js` → `PUBLISHED = false` → `true` (tira banner de prévia). Confirmar preços reais (hoje ilustrativos: essencial 149 / pro 249 / avançado 399 mensal na t1).
3. **Multi-linha:** NÃO existe (um número por empresa). Só Faixa 1 à venda (`AVAILABLE_TIERS = ['t1']`). Quando construir, adicionar `t2`/`t3` e reativar UI de faixas + enforcement do teto (`line_cap`).
4. **Blindagem pré-escala:** ligar **RLS** + índices em todas as tabelas `crm_*`/`whatsapp_*`/`flowmate_*`/`companies`/`pending_signups` (hoje RLS OFF, filtragem no cliente = risco LGPD). Medir quantas linhas Evolution cabem por RAM no Railway antes de vender volume.
5. **Export de dados** do tenant (destrava a copy "seus dados são seus" na landing — hoje omitida por não existir).
6. **Automações — implementar de verdade:** `send_email` (Resend), `wait_days` + gatilho `lead_inactive` (Vercel Cron). Estão marcados "em breve" na UI.
7. **Confirmação de e-mail do Supabase:** está LIGADA (causou bug de redirect). O fluxo pagamento-primeiro contorna (cria user server-side). Se for usar signup direto algum dia, desligar em Authentication → Providers → Email, ou configurar Site URL = produção.
8. **Provisionador de cliente (admin):** tela pra criar empresa + ativar + configurar integração + devolver as chaves num clique, substituindo o runbook SQL acima. Recomendado — vai onboardar várias clínicas (Atimos).
9. **Publicar a doc de API como página** dentro do app (hoje é o `INTEGRATIONS.md` no repo). Útil pra vender o Pro.
10. **Integração para equipe de marketing** — próximo objetivo do usuário, ainda a especificar.

## LIMPEZA pendente (dados de teste)
- Contatos "Teste 409" e "Teste Idempotencia" no CRM.
- Clientes/assinaturas de teste no Asaas sandbox.
- Linhas de teste em `pending_signups`.
- **Regenerar** chaves que passaram pelo chat: a API key de integração da empresa (Configurações → Integrações → ↻) e a chave sandbox do Asaas.

## GOTCHAS (erros que já aconteceram — evitar de novo)
- **Tela branca = ReferenceError de runtime** por variável órfã após refactor. O `vite build` NÃO pega (não é erro de sintaxe). **Antes de mandar testar após refactor grande, rode `grep` procurando referências órfãs.**
- **Repo privado quebra deploy** no Hobby (status "Blocked / user not found"). Manter público OU garantir que o autor do commit seja o email da conta Vercel.
- **HMAC:** assinar o **corpo bruto** (uma serialização, mesmo buffer no HMAC e no fetch). Reserializar quebra com acento/emoji.
- **12 functions:** não adicionar arquivo novo em `api/`.

## Feedback/preferências do usuário
- Valoriza muito UI/UX limpa e minimalista. Quer o produto com "cara de mercado".
- Preza segurança (auditar áreas sensíveis). Confirmar envio em massa com 1 contato antes de disparar.
- Quer lançar rápido, mas com honestidade (não anunciar recurso que não existe).
