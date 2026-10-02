# FlowMate — Estado do Projeto (Handoff)

> Documento vivo pra retomar o projeto em sessão nova, com contexto zerado.
> **Sem segredos aqui** — chaves ficam nas env vars do Vercel / painéis.
> Última atualização: 2026-09-29.
>
> **WhatsApp — mensagens e mídia OK (confirmado pelo usuário em 2026-09-28):** `supabase_whatsapp_media.sql` foi rodada, o buraco de histórico foi recuperado e mensagens/mídia novas chegam em tempo real. Ver PENDÊNCIAS A0 pro que ainda falta (Railway, limpeza Atimos).
>
> **Criar grupo — corrigido e confirmado (2026-09-29):** o botão "Novo grupo" dava 502. Duas causas em cascata, corrigidas em `0e7d179`/`2a72397`: (1) o código só sabia ler erro no formato v1 (`err.message`), então qualquer falha da v2 virava "delivery_failed" sem pista — trocado pro helper `evo()`, que loga a resposta crua e extrai `response.message` (formato v2); (2) com o erro real visível, apareceu `instance requires property "subject"`: o `POST /group/create` da v2 usa o campo **`subject`**, não `groupName` (v1). Usuário confirmou criando grupo pela UI.
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
- **WhatsApp:** Evolution API **v2.3.7** (imagem `evoapicloud/evolution-api:latest` — ⚠️ sem versão fixa) self-hosted no **Railway**, projeto `triumphant-unity` (serviços: `evolution-api`, Postgres, Redis), domínio `evolution-api-production-3a96.up.railway.app`. Uma instância por empresa: `flowmate-{company_id}`. Plano Railway **Hobby** (o trial acabou em ago/2026). Ver "Incidente Railway".
- **Pagamento:** **AbacatePay v1** (chave `abc_dev_` de teste; KYC em análise). Asaas é legado, saindo. Detalhes em PENDÊNCIAS nº 1.
- **Repo:** `github.com/hdirr/flowmate` (público), branch `main`, auto-deploy no push. **Pasta local real: `C:\Users\lenovo\Agadir\FlowMate`** (a pasta `C:\Users\lenovo\FlowMate` é quase vazia, não é o repo).
  - Push: `git push origin main` (credencial já configurada na máquina; não colocar token na URL do remote).

### Proxy Supabase (importante)
O provedor do Agadir bloqueia o TLD `.co`, então TODAS as chamadas Supabase passam por `/sb-proxy` (rewrite no `vercel.json`). Por isso o **Realtime (WebSocket) foi desativado** — usa-se **polling**. Solução definitiva futura: domínio próprio pro Supabase.

## Limite crítico: Vercel Hobby = 12 serverless functions (hoje 7 arquivos, graças aos catch-alls)
Não crie novos arquivos em `api/` sem consolidar. Rotas novas vão em catch-alls (`[...path].js`).
Funções atuais (7 arquivos): `users`, `public/lead`, `conversations/state`, `integrations/emit`, `v1/[...path]`, `billing/[...path]`, `whatsapp/[...path]` (catch-all único, rotas: `connect`, `send`, `send-media`, `status`, `sync`, `webhook`, `groups`, `history` — os 6 arquivos antigos foram removidos).
Compartilhados (não contam): `api/_lib/{db,conversations,sendMessage,webhooks,plans,v1handlers}.js`.

## Env vars no Vercel (nomes; valores só no painel)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `APP_URL`, `WEBHOOK_SECRET` (opcional),
`ASAAS_API_KEY`, `ASAAS_API_URL` (legado — saindo), `ASAAS_WEBHOOK_TOKEN`.
**AbacatePay (novo provedor):** `ABACATEPAY_API_KEY` (v1; hoje chave `abc_dev_` de teste), `ABACATEPAY_WEBHOOK_SECRET`. Base fixa no código: `https://api.abacatepay.com/v1`.

---

## Funcionalidades PRONTAS (no ar)
- **CRM:** Contatos (seleção múltipla), Pipeline **multi-funil** com acesso por usuário, campos personalizados, notas, tags, Dashboard com métricas por funil, Importar.
- **WhatsApp:** conexão por QR (Configurações), Chats (só contatos do CRM), envio/recebimento, **anexos (foto/vídeo/PDF)** via Supabase Storage (bucket `whatsapp-media`), botão "Chat" em Contatos/Pipeline, editar contato dentro do Chat.
- **Estado de conversa `automation | human`** com **enforcement 409** no ponto de saída (`api/_lib/sendMessage.js`). Badge + botão "devolver p/ automação" no Chat. Detecta resposta pelo celular (fromMe desconhecido → human). **Validado em produção.**
- **API de consumidor `/v1`** (a "boca e mãos" do n8n): `POST /v1/messages` (409 se human), `POST /v1/leads` (idempotente por `external_id`), `GET /v1/fields`, `GET/PATCH /v1/contacts` (escreve campos por id ou nome, tags, move etapa/funil), `GET /v1/messages` (histórico), `POST /v1/notes`. Auth por `x-api-key` (company_integrations.api_key).
- **Webhooks de saída** assinados (HMAC-SHA256 sobre `${ts}.${rawBody}`, header `X-Flowmate-Signature`), com `event_id` no payload. Eventos: `message.received` (só quando automation), `message.sent`, `contact.created`, `lead.created`, `lead.moved`. Config em Configurações → Integrações.
- **Automações:** gatilhos (lead_entered_stage, lead_moved_stage, contact_created, tag_added, lead_lost) + ações (WhatsApp real com mídia, mover etapa cross-funil, nota, tag, prioridade, campo, webhook, alert_overdue). "Executar agora" em massa por etapa.
- **Novos contatos chegando** (`src/components/NewArrivals.jsx` na tela Início): lista quem mandou WhatsApp e ainda não está no CRM (cruza telefone canônico — últimos 11 dígitos — com `crm_contacts`). Só admin/gestor. Ações: **Adicionar** (cria contato; via dropdown escolhe o **funil** de destino → cria lead no 1º estágio, roteando pra quem tem acesso àquele funil via `allowed_users`) e **Ignorar** (marca como "não é cliente", grava em `ignored_arrivals`, some e não volta). Auto-limpa: ao adicionar, vira contato e sai da lista. Fase 2 possível: config de visibilidade por vendedor / rodízio automático.
- **Landing pública** (`src/pages/Landing.jsx`) + **fluxo pagamento-primeiro** (ver abaixo).
- **Doc pública de integração:** `INTEGRATIONS.md` (webhook + /v1 + regras pro n8n).

## Fluxo de venda: PAGAMENTO-PRIMEIRO (implementado)
```
Landing → "Assinar {nível}"
  → /assinar (Checkout: nome + email + CPF + celular/WhatsApp)          src/pages/Checkout.jsx
  → POST /api/billing/start (cria cobrança AbacatePay, grava pending_signups)
  → checkout hospedado da AbacatePay (aba nova) → cliente paga
  → AbacatePay → POST /api/billing/webhook (valida ?webhookSecret=) → pending_signups.status='paid'
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
- `companies`: `subscription_status, plan_level, plan_tier, plan_cycle, line_cap, current_period_end, abacate_customer_id, abacate_billing_id` (+ colunas `asaas_*` legadas)
- `pending_signups`
- `whatsapp_instances`, `whatsapp_messages` (criadas fora das migrações do repo) — as colunas `media_url`, `file_name`, `participant_jid`, `sender` **podem não existir em produção**: aplicar `supabase_whatsapp_media.sql` (2026-09-26; a falta de `file_name` derrubou todos os inserts do webhook)
- `ignored_arrivals` (novos contatos ignorados) — `supabase_ignored_arrivals.sql`
- `whatsapp_groups` — `supabase_groups.sql` (2026-09-25)
- Colunas de assinatura em `companies`/`pending_signups` — `supabase_billing_columns.sql` (2026-09-25)
- Colunas `abacate_*` — `supabase_abacate.sql` (confirmar que rodou)
- **NÃO RODADA (2026-09-26):** `supabase_whatsapp_cache.sql` (`updated_at` + trigger em `whatsapp_instances`; habilita o cache de 45s do `/status`)

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

### Clientes
- Nenhum cliente externo ativo. A **Clínica do Rafael** (parceria Atimos, company `f8a5a268-…`) foi **encerrada em 2026-09-26** — sem mais vínculo; empresa e usuário já excluídos do Supabase; instância Evolution e fluxo n8n ainda a remover.

## Grupos de WhatsApp
Criação pela UI em `src/pages/Chats.jsx` (participantes = só contatos do CRM), chat de grupo com texto/mídia, filtro Todas|Conversas|Grupos, grupo ignora a regra de pausa `automation|human`. Automação **"Enviar p/ grupo"** (`send_whatsapp_group` em `Automations.jsx` + `lib/store.js`, `sender:'automation'`). Rotas `GET/POST /api/whatsapp/groups`. Filtros `@g.us` em `NewArrivals.jsx`/`NotificationBell.jsx`; `_lib/conversations.js` ignora `@g.us/@broadcast/@newsletter` para contatos. Migrações já rodadas: `supabase_groups.sql` (tabela `whatsapp_groups`) e `supabase_billing_columns.sql` (colunas de assinatura em `companies`/`pending_signups`; resolveu o 400 do shell do app).
- **`POST /group/create/{instance}` da Evolution v2 usa o campo `subject`** (não `groupName`, que é v1) — corrigido em `2a72397` e confirmado funcionando (2026-09-29).

## WhatsApp — como as mensagens fluem (estado pós 2026-09-25)
- **Supabase guarda só os últimos 7 dias** (`whatsapp_messages`). A **Evolution é o arquivo completo**. `Chats.jsx` carrega a janela de 7d; ao rolar pra cima faz **scroll infinito** via `POST /api/whatsapp/history` (`{jid,page,limit,beforeTs}`), que lê a Evolution paginado e **não persiste** no Supabase.
- **Entrada em tempo real:** webhook `messages.upsert` → `handleWebhook` (grava em `whatsapp_messages`, dedup por `message_id`). Polling do front por **id** a cada 3s.
- **Sync (`POST /api/whatsapp/sync`, botão "Importar conversas"):** paralelo (`CONCURRENCY=8`), busca chats/grupos/mensagens na Evolution, upsert em lote (chunks de 500), filtra `timestamp >= CUTOFF (7d)`. **Prune:** apaga do Supabase só por **idade** (> 7d + 2d de margem), nunca por "não veio neste fetch", e **só roda se a Evolution devolveu chats** (trava contra Evolution vazia/fora do ar). Logs `[synctrace <id>] ...` (rótulo único por chamada). O sync também refaz o `webhook/set` (auto-heal).
- **Webhook da Evolution v2:** o corpo de `/webhook/set` e do `/instance/create` usa o helper `webhookConfig()` → `{ webhook: { enabled, url, byEvents:false, base64:false, events:['CONNECTION_UPDATE','MESSAGES_UPSERT'] } }`. Corpo "plano" (sem o objeto `webhook`) dá 400 `instance requires property "webhook"` e as mensagens novas deixam de chegar.
- **`/status` com cache de 45s** (lê `whatsapp_instances.updated_at`, mantido por trigger). Exige rodar `supabase_whatsapp_cache.sql`; sem a coluna ele cai no caminho lento (Evolution) — **a migração ainda NÃO foi rodada** (o app funciona, só sem o cache).
- **Mídia recebida (2026-09-26):** `parseMessage()` (api/whatsapp) detecta o tipo (`image|video|audio|document|sticker`, desembrulhando efêmera/ver-uma-vez/editada) e grava `message_type` + `file_name` no webhook, no sync e no `/history` (antes tudo virava `text`/`[mídia]`, e mídia sem legenda era descartada no `/history`). O arquivo é baixado **sob demanda** por `POST /api/whatsapp/media {message_id}`: pede à Evolution (`chat/getBase64FromMediaMessage/{instance}`, corpo `{message:{key:{id}},convertToMp4:false}`), sobe pro bucket público `whatsapp-media` em `{company}/in/{id}.{ext}`, guarda `media_url` (cache) e devolve `{url,type}`; limite 20 MB. No front, `MediaAttachment` (Chats.jsx): imagem/sticker carregam sozinhos ao entrar na tela (IntersectionObserver); áudio (`<audio controls>`), vídeo e documento carregam ao clicar. Mensagens antigas `[mídia]` (tipo `text`) mostram "Carregar mídia" e o tipo é inferido pelo mimetype. **Não testado contra a Evolution real** — confirmar nome/corpo do endpoint na primeira mídia recebida (logs `[whatsapp] POST /chat/getBase64FromMediaMessage… falhou`). Áudio do WhatsApp é ogg/opus: toca no Chrome, não no Safari. **Ainda não existe:** enviar áudio, baixar mídia já no webhook (links do WhatsApp expiram), foto de perfil/dados do contato (`chat/fetchProfilePictureUrl`, coluna `avatar_url` em `crm_contacts` exigiria SQL).
- **Armadilhas que já custaram mensagens (2026-09-26):** (1) o Supabase corta consultas em **1000 linhas** — a carga inicial do Chats agora pagina (`fetchWindowMessages`); sem isso as mensagens mais novas sumiam e o polling por id nunca as buscava. (2) Gravar coluna que não existe em `whatsapp_messages` faz o insert falhar com erro só nos logs (`[webhook] insert falhou ...`) — **toda coluna nova precisa de migração aplicada ANTES do deploy que a usa**. `sendMessage.js` ainda não verifica erro do insert.
- **Chats:** ao conectar com banco vazio, faz auto-import uma vez. Aba "Conversas" só lista contatos do CRM (por design); "Todas" mistura grupos.

## Incidente Railway (2026-08 → 09)
O trial do Railway acabou no início de agosto e derrubou Postgres/Redis/Evolution. Em 2026-09-25 o plano Hobby foi ativado e tudo redeployado; o Postgres então crashou com `PANIC: could not write to file "pg_wal/...": No space left on device` (volume de **500 MB**, não corrupção). Volume ampliado para **5 GB** (teto do Hobby; cobra só pelo armazenado), Postgres e Evolution reiniciados. Sintoma no app: "Application not found" (borda do Railway) e depois Prisma `P1001`. **Efeito colateral:** o histórico que a Evolution tinha foi perdido; o WhatsApp só reenvia histórico **uma vez por pareamento**, então para repopular é preciso **reconectar o número (novo QR)**. Foi a sincronização de histórico que encheu os 500 MB.
**A decidir (Railway, não é código):** ajustar `DATABASE_SAVE_*` da Evolution (`DATABASE_SAVE_DATA_HISTORIC`, `DATABASE_SAVE_MESSAGE_UPDATE`; mídia em S3 e não base64 no banco) — mas o `/history` e o sync dependem das mensagens guardadas na Evolution, então não desligar o que elas leem sem pensar; **fixar a versão da imagem** (hoje `:latest`); **monitorar o uso do volume**.

## PENDÊNCIAS / PRÓXIMOS PASSOS
A0. **WhatsApp pós-incidente:** (a)–(d) feitos e confirmados (webhook v2, migração de mídia rodada, histórico recuperado, mensagens em tempo real funcionando — ver nota no topo). (e) decidir `DATABASE_SAVE_*` da Evolution e **fixar a versão da imagem**; (f) acompanhar o uso do volume de 5 GB; (g) empresa **Clínica do Rafael** (`f8a5a268-…`, Atimos) **encerrada em 2026-09-26**: empresa e usuário `rafael@atimosbrasil.com` **já excluídos do Supabase** (confirmado: 0 empresa, 3 usuários restantes); **falta** apagar a instância `flowmate-f8a5a268-…` na Evolution e desativar o fluxo no n8n da Atimos. O provisionador/runbook segue valendo para clientes futuros.
1. **Pagamento: migrando Asaas → AbacatePay** (resolve o branding/CNPJ no checkout). **Fase 1 (código PRONTO, teste devMode pendente):** `api/billing/[...path].js` reescrito pro AbacatePay v1 — cobrança avulsa `ONE_TIME` com produto **inline** (preço do `plans.js`, servidor manda), PIX; webhook `billing.paid` verificado por `?webhookSecret=`; correlação pelo `abacate_billing_id`. Contrato do front intacto (`start`→`{url,token}`). Migração `supabase_abacate.sql` (colunas `abacate_*`). O campo **Celular/WhatsApp** já é coletado no Checkout e validado no servidor (`customer.cellphone` é obrigatório no AbacatePay — commit `bf620eb`). **A confirmar em devMode:** shape exato do payload do webhook e habilitar `methods:['CARD']`. **Fase 2 (a fazer):** assinatura automática no cartão (recorrência de verdade) = API **v2** (`/checkouts/create` frequency=SUBSCRIPTION, eventos `subscription.*`). **Go-live:** conta AbacatePay em verificação (KYC via Woovi, até 72h desde 2026-07-29); quando aprovada → trocar `ABACATEPAY_API_KEY` de teste pela de produção + `PUBLISHED=true`. Ver [[flowmate-payment-abacatepay]].
2. **Ligar preço público:** `src/lib/pricing.js` → `PUBLISHED = false` → `true` (tira banner de prévia). Confirmar preços reais (hoje ilustrativos: essencial 149 / pro 249 / avançado 399 mensal na t1).
3. **Multi-linha:** NÃO existe (um número por empresa). Só Faixa 1 à venda (`AVAILABLE_TIERS = ['t1']`). Quando construir, adicionar `t2`/`t3` e reativar UI de faixas + enforcement do teto (`line_cap`).
4. **Blindagem pré-escala:** **RLS LIGADO** em 2 etapas.
   - `supabase_rls.sql` (2026-07-25): adicionou políticas `tenant_isolation` por `company_id` + helpers `get_my_company_id`/`get_my_role` como `SECURITY DEFINER` (recursão era o motivo do RLS estar OFF antes) + trancou tabelas só-servidor.
   - ⚠️ **INCIDENTE + CORREÇÃO** `supabase_rls_fix.sql` (2026-07-25): o `rls.sql` sozinho **não fechou o vazamento** — o banco tinha políticas ANTIGAS abertas (`qual=true`: "public read contacts/leads/stages", "Enable all for anon users") e no Postgres policies permissivas se somam com **OU**, então uma `true` anula o isolamento. Enquanto isso valeu, `crm_contacts`/`crm_leads`/`crm_stages` e `flowmate_*` ficaram **lidos/escritos por qualquer um com a anon key (pública)**. O fix REMOVE as políticas furadas + duplicatas e endurece 3 brechas internas: auto-escalada de papel (`user_profiles.update_own`), escrita/apagar log (`whatsapp_messages.company_own`) e escrita de permissões por não-admin (`role_permissions`). **`whatsapp_messages` — as conversas dos pacientes — SEMPRE esteve protegida.** Verificação e estado final documentados no topo/fim do `supabase_rls_fix.sql`.
   - **LIÇÃO:** ao ligar RLS, **auditar `pg_policies` ANTES** — adicionar política não basta; uma única policy `true` preexistente anula tudo. Rodar sempre a Verificação 1 (nenhuma `qual=true`).
   - **Índices:** `supabase_indexes.sql` pronto (company_id + hot paths: `conversations(company_id,remote_jid)` por msg recebida, `whatsapp_messages`, `crm_*`). Rodar após o RLS. **Ainda pendente:** medir quantas linhas Evolution cabem por RAM no Railway antes de vender volume.
5. **Export de dados** do tenant (destrava a copy "seus dados são seus" na landing — hoje omitida por não existir).
6. **Automações — implementar de verdade:** `send_email` (Resend), `wait_days` + gatilho `lead_inactive` (Vercel Cron). Estão marcados "em breve" na UI.
7. **Confirmação de e-mail do Supabase:** está LIGADA (causou bug de redirect). O fluxo pagamento-primeiro contorna (cria user server-side). Se for usar signup direto algum dia, desligar em Authentication → Providers → Email, ou configurar Site URL = produção.
8. **Provisionador de cliente (admin):** tela pra criar empresa + ativar + configurar integração + devolver as chaves num clique, substituindo o runbook SQL acima. Recomendado quando houver volume de clientes.
9. **Publicar a doc de API como página** dentro do app (hoje é o `INTEGRATIONS.md` no repo). Útil pra vender o Pro.
10. **Integração para equipe de marketing** — próximo objetivo do usuário, ainda a especificar.

## LIMPEZA pendente (dados de teste)
- Contatos "Teste 409" e "Teste Idempotencia" no CRM.
- Cobranças/clientes de teste no AbacatePay (devMode) e resíduos do Asaas sandbox.
- Linhas de teste em `pending_signups`.
- **Regenerar** chaves que passaram pelo chat: a API key de integração da empresa (Configurações → Integrações → ↻) e a chave sandbox do Asaas (legado).

## GOTCHAS (erros que já aconteceram — evitar de novo)
- **Nunca versionar dados pessoais, nem com hash; evidências usam pseudônimos não derivados (ex.: contato-001), com o mapa só fora do repo.** (Regra de 2026-10-01: as evidências da P1-L7 foram publicadas com SHA-256 sem chave, reversível por força bruta; o repo foi tornado privado. Ver "Revisão de segurança (futura)" em `docs/roadmap-api/relatorios/pendencias-P1-Z.md`.)
- **Tela branca = ReferenceError de runtime** por variável órfã após refactor. O `vite build` NÃO pega (não é erro de sintaxe). **Antes de mandar testar após refactor grande, rode `grep` procurando referências órfãs.**
- **Repo privado quebra deploy** no Hobby (status "Blocked / user not found"). Manter público OU garantir que o autor do commit seja o email da conta Vercel.
- **HMAC:** assinar o **corpo bruto** (uma serialização, mesmo buffer no HMAC e no fetch). Reserializar quebra com acento/emoji.
- **12 functions:** não adicionar arquivo novo em `api/`.
- **Catch-all `[...path].js` na Vercel (fora do Next.js):** `req.query.path` pode chegar `undefined` — o segmento vem como `req.query['...path']`. Todo roteador catch-all DEVE ter o fallback que deriva a rota de `req.url` (como já têm `v1/` e `billing/`). O `whatsapp/` não tinha e, por isso, TODA sub-rota caía em `handleGroups` (`path=''`): `POST /connect` dava 400 "Nome e participantes são obrigatórios", GET em rota inexistente dava 401 em vez de 404. Corrigido em `c2ab1dd`. **Smoke test de roteamento (sem login):** `GET /api/whatsapp/connect`→405, `GET /api/whatsapp/qualquer_coisa`→404 `route_not_found`, `GET /groups`→401.
- **Diagnóstico de deploy que NÃO era o problema (não repetir):** Production Branch (hoje em Settings → Environments → Production → Branch Tracking), promoção de deploy, alias do domínio, build cache, Firewall/Deployment Protection. Quando o comportamento em produção contradiz o código, **logar `req.url`/`req.query` na function** e ler em Vercel → Logs antes de teorizar sobre infra.
- **QR do WhatsApp:** `qr` deve chegar ao front como **string**; `Settings.jsx` fazia `waQr.startsWith(...)` sem checar tipo e derrubava a página (tela branca, sem error boundary). Backend (`fetchQr`) só devolve `qr` se for string; front valida o tipo. Se a Evolution não devolver QR, o 400 traz o corpo cru dela ("Sem QR na resposta da API: (status) corpo").
- **Erro `Application not found` (404 JSON com `request_id`)** ao conectar = borda do **Railway** sem serviço ativo naquele domínio (Evolution caída/removida/sem crédito, ou `EVOLUTION_API_URL` desatualizada) — não é bug do FlowMate.

## Feedback/preferências do usuário
- Valoriza muito UI/UX limpa e minimalista. Quer o produto com "cara de mercado".
- Preza segurança (auditar áreas sensíveis). Confirmar envio em massa com 1 contato antes de disparar.
- Quer lançar rápido, mas com honestidade (não anunciar recurso que não existe).
