# 11 — Parte 1: segurança (P1-S*)

Contexto: em 29/09/2026 o Agadir já corrigiu no banco (SQL, sem código):
- `companies` virou **só leitura** para usuários (política `tenant_read`, `SELECT`).
- `company_integrations` virou **só admin** (política `admin_only`).
- `register_company` não pode mais ser chamada por `anon`/`authenticated` (só `service_role`).

As tarefas abaixo fecham o que falta no código.

---

## P1-S1 — Webhook da AbacatePay recusa sem segredo

**Arquivo:** `api/billing/[...path].js`, função `webhook`.

**Hoje:** `if (ABACATE_WEBHOOK_SECRET) { ...confere... }`. Sem a variável configurada, **qualquer
pessoa** pode mandar `billing.paid` e ativar uma conta sem pagar (o `pending_signups` vira
`paid` e o `/activate` cria a conta).

**Fazer:**
1. Se `ABACATE_WEBHOOK_SECRET` estiver vazio: logar
   `[billing] webhook recusado: ABACATEPAY_WEBHOOK_SECRET não configurado` e responder
   `503 { error: 'webhook_not_configured' }`. Nada é gravado.
2. Comparação do segredo em **tempo constante** (`crypto.timingSafeEqual` com guarda de tamanho,
   igual ao padrão do `INTEGRATIONS.md`). Continua aceitando query `?webhookSecret=` e os headers
   que já aceita.

**Efeito esperado:** nenhum hoje (ninguém paga de verdade). No teste em devMode da AbacatePay a
ativação automática só volta a funcionar quando o Agadir configurar a variável — isso é desejado.

**Teste:** ver `16-parte1-testes.md`, P1-S1.

---

## P1-S2 — Trava de assinatura fecha quando o status é desconhecido

**Arquivos:** `src/lib/auth.js` (`subscriptionActive`), `src/App.jsx`, `src/pages/Onboarding.jsx`.

**Hoje:** `subscriptionActive()` devolve `true` quando `subscription_status` é `null`/`undefined`
("falha-aberto", criado para não trancar empresas antigas antes da migração).

**Antes de codar — peça ao Agadir para rodar e colar o resultado:**
```sql
select id, name, subscription_status from companies
where subscription_status is distinct from 'active';
```
Se vier alguma empresa que deve continuar usando, ele ativa no SQL antes do deploy.

**Fazer:**
1. `subscriptionActive()` passa a devolver `true` **somente** para `'active'`.
2. Separe "não consegui carregar a empresa" (erro de rede/consulta, `_company` nulo) de
   "empresa sem assinatura". No primeiro caso, mostre uma tela simples
   "Não foi possível verificar sua assinatura" com botão **Tentar de novo** (chama
   `auth.reloadCompany()`), **não** a tela de cobrança. No segundo, a tela `Billing` de hoje.
3. **Onboarding:** usuário logado sem perfil cai em `status === 'onboarding'`, e a tela chama a
   RPC `register_company` — que agora é recusada pelo banco (desejado). Troque o conteúdo da tela
   por uma mensagem: "Sua conta ainda não tem uma empresa ativa. Para usar o FlowMate, assine um
   plano." com botão para `/assinar` e botão **Sair**. Remova a chamada da RPC. Não apague o
   arquivo (pode voltar a ser usado num fluxo de convite).
4. Procure referências órfãs depois (`grep -rn "register_company\|subscriptionActive" src`).

**Teste:** login com a empresa do Agadir (ativa) abre normal; ver roteiro em `16`.

---

## P1-S3 — Webhook da Evolution recusa sem segredo ⛔

**Não comece** antes de o Agadir confirmar os 4 passos abaixo (é ele quem faz):
1. Variável `WEBHOOK_SECRET` criada na Vercel (Production).
2. Redeploy feito.
3. No FlowMate → Chats → **Importar conversas** (o sync refaz o `webhook/set` na Evolution com a
   URL nova, que leva `?secret=`).
4. Mensagem nova de WhatsApp aparecendo no Chats depois disso.

**Arquivo:** `api/whatsapp/[...path].js`, função `handleWebhook`, só o bloco de verificação no
topo. **Não toque no resto da função.**

**Fazer:**
1. Se `process.env.WEBHOOK_SECRET` estiver vazio: logar
   `[webhook] recusado: WEBHOOK_SECRET não configurado` e responder `503`.
2. Comparação em tempo constante (`timingSafeEqual` + guarda de tamanho). Continua aceitando
   `?secret=` e o header `x-webhook-secret`.

**Teste:** POST sem segredo → 401/503; mensagem real chega no Chats; ver `16`.

**Se as mensagens pararem de chegar:** reverta na hora (`git revert` + push) e relate.

---

## P1-S4 — `/api/integrations/emit` só com eventos e ids válidos

**Arquivo:** `api/integrations/emit.js`.

**Hoje:** qualquer usuário logado manda **qualquer** `event` e **qualquer** `data`, e o servidor
assina com o segredo da empresa e entrega no n8n. Um vendedor consegue forjar eventos que o n8n
trata como verdadeiros.

**Fazer:**
1. Lista fechada: `contact.created`, `lead.created`, `lead.moved`. Outro valor →
   `400 { error: 'event_not_allowed' }`.
2. **Não confiar no `data` do navegador.** Usar dele só o id e montar o payload no servidor,
   lendo do banco **com filtro de `company_id`**:
   - `contact.created`: `data.contact_id` → busca em `crm_contacts` → payload
     `{ contact_id, name, phone, email }`.
   - `lead.created` e `lead.moved`: `data.lead_id` → busca em `crm_leads` → payload
     `{ lead_id, contact_id, stage_id, pipeline_id }`.
   - Id inexistente ou de outra empresa → `404 { error: 'not_found' }`, nada é enviado.
3. O formato do payload continua o mesmo de hoje (não quebra quem consome).

Fica de fora (Parte 2, bloco 2): reenvio repetido de um evento verdadeiro e o fim desta rota.

---

## P1-S5 — Limpar exemplos do `INTEGRATIONS.md`

**Arquivo:** `INTEGRATIONS.md`.

- Trocar a chave de exemplo da seção "Autenticação" (32 caracteres hexadecimais, começa com
  `cf54`) por `SUA_CHAVE`.
- Trocar o `company_id` de exemplo do payload (UUID que começa com `9899`) por
  `00000000-0000-0000-0000-000000000000`.
- Procurar no repo inteiro (`grep -rn "cf54\|9899"`) e trocar onde mais aparecerem. Este
  arquivo do roadmap cita só o começo dos valores, de propósito.

**Avise o Agadir no relatório:** o repo é público e o histórico do git guarda os valores antigos;
ele precisa **regenerar a chave** em Configurações → Integrações (botão ↻), se ainda não fez.
