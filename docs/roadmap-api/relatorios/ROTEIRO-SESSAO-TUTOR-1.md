# Roteiro — sessão com o tutor: janela 0 da Evolution + `JOBS_SECRET` + PARTE 7

Uma sessão só, nesta ordem. **Nenhum valor de segredo vai para o chat, o repo ou print**: só
para o cofre e para os painéis. Horário de pouco movimento; celular da empresa à mão (pode pedir
QR). Antes de cada passo, anote o valor **atual** no cofre (é o rollback).

## Pré-requisitos
- O commit da A2 no ar e o `supabase_cf_a2_drop_global.sql` rodado (remove a chave global).
  Pode ser na mesma sessão, antes do bloco A.
- A conta no cofre da empresa para os segredos novos.

---

## Bloco A — Janela 0: fixar a Evolution e as variáveis de gravação (Railway)
Detalhes e motivos em `PLANO-S3-W2.md`, janela 0. Resumo:
1. **Anotar o que roda hoje:**
   - Railway → `evolution-api` → Deployments → deployment ativo → **imagem e digest**
     (`sha256:…`);
   - `GET https://<domínio da Evolution>/` → campo de versão;
   - anotar os dois e todas as **Variables** atuais do serviço.
2. **Fixar a imagem:** Settings → Source → Image = `evoapicloud/evolution-api@sha256:<digest
   anotado>`. É exatamente o que roda hoje; usar a tag `v2.3.7` só se o tutor preferir, e aí
   tratar como atualização.
3. **Variáveis** (declarar **todas**, porque na 2.3.7 variável ausente = `false`):
   - `DATABASE_SAVE_DATA_NEW_MESSAGE=true`
   - `DATABASE_SAVE_DATA_HISTORIC=true` (decisão; ver o plano)
   - `DATABASE_SAVE_MESSAGE_UPDATE=false`
   - `DATABASE_SAVE_DATA_CHATS=true`, `DATABASE_SAVE_DATA_CONTACTS=true`
   - `DATABASE_SAVE_DATA_LABELS=false`
   - `WEBHOOK_REQUEST_TIMEOUT_MS=30000`, `WEBHOOK_RETRY_MAX_ATTEMPTS=10`
4. **Redeploy** (uma vez). Esperar "Active".
5. **Validar (lista V):**
   1. Configurações → WhatsApp: conectado (se pedir QR, escanear);
   2. mensagem de outro aparelho aparece no Chats em segundos;
   3. envio pela tela chega no celular;
   4. responder pelo celular → a conversa vira "humano";
   5. `GET /` da Evolution mostra a mesma versão anotada;
   6. me pedir o smoke da `/v1`.
6. **Rollback:** imagem e variáveis anotadas no passo 1 → Redeploy.

## Bloco B — `JOBS_SECRET` na Vercel (Production)
1. **Gerar** (PowerShell; 64 caracteres hex, sem caractere especial):
   ```powershell
   $s = -join (1..32 | ForEach-Object { '{0:x2}' -f [System.Security.Cryptography.RandomNumberGenerator]::GetInt32(256) }); Set-Clipboard $s
   ```
   Colar no cofre como "FlowMate — JOBS_SECRET".
2. **Vercel** → projeto → Settings → Environment Variables → **Add**: nome `JOBS_SECRET`,
   valor colado, ambiente **Production**.
3. **Redeploy** do último deployment de produção (sem isso a variável não vale).
4. **Validar:**
   - `POST https://flowmate-ashy.vercel.app/api/whatsapp/jobs` **sem** o header → **401**
     (antes era 503);
   - eu posso fazer essa checagem.
5. **Rollback:** apagar a variável + Redeploy (a rota volta a 503 e nada roda).

## Bloco C — PARTE 7 do `supabase_cf_a.sql` (agendador no Supabase)
No SQL Editor, **uma instrução por vez**, com o mesmo valor do bloco B no lugar de
`COLE_AQUI_O_JOBS_SECRET`:
1. `create extension if not exists pg_cron;`
2. `create extension if not exists pg_net;`
3. o bloco `do $vault$ … $vault$` (cria ou atualiza o segredo `flowmate_jobs_secret` no Vault).
   **Depois apagar o snippet/histórico** do SQL Editor que contém o valor e limpar a área de
   transferência (`Set-Clipboard ' '` no PowerShell).
4. o `select cron.schedule('flowmate-jobs', '* * * * *', …)`.
5. **Conferir:**
   - `select jobid, schedule, active from cron.job where jobname = 'flowmate-jobs';`
     → 1 linha, `active = true`;
   - depois de 2–3 minutos:
     `select status_code, created from net._http_response order by created desc limit 5;`
     → **200** (a rota responde `{ ok: true, inbound: …, reconcile: … }`; sem chave ligada, não
     faz nada).
   - Se vier **401**: o valor do Vault é diferente do da Vercel.
   - Se vier **503**: o redeploy do bloco B não foi feito.
6. **Rollback:**
   - `select cron.unschedule('flowmate-jobs');`
   - `delete from vault.secrets where name = 'flowmate_jobs_secret';`

## Depois da sessão (comigo)
- Confirmo pelos logs da Vercel que o `[jobs]` roda a cada minuto, sem erro.
- Ligar `inbound_inbox` e `reconcile` **só na empresa do Agadir**, quando ele decidir, seguindo
  as condições dos relatórios CF-A1 e CF-A4.
- A janela 1 (troca da `EVOLUTION_API_KEY`) e a janela 2 (`WEBHOOK_SECRET`) do
  `PLANO-S3-W2.md` ficam para outra sessão.
