# 00 — Contexto e regras

Leia inteiro antes da primeira tarefa. O `HANDOFF.md` na raiz do repo é o estado completo do
projeto; este arquivo resume o que importa para o roadmap da API e acrescenta regras novas.

## 1. O produto

FlowMate é um **CRM de WhatsApp com automação**, vendido como SaaS pelo Agadir. Produção:
`https://flowmate-ashy.vercel.app`. Hoje está **em teste**: nenhum cliente externo ativo, só a
empresa do próprio Agadir. O objetivo deste roadmap é que um cliente consiga automatizar tudo
pelo **n8n** (ou Make, ou script próprio) usando a API `/v1` e os webhooks de saída — no mesmo
nível do que ele faz hoje na Helena CRM.

Princípio que não muda: **o FlowMate é o gateway único do WhatsApp.** Automação externa nunca
fala com a Evolution nem com o banco; só com `/v1` (entrada) e recebe webhooks (saída).

## 2. Arquitetura (o que você vai tocar)

| Camada | Onde | Observação |
| --- | --- | --- |
| Front | `src/` (React + Vite + Tailwind) | Grava **direto no Supabase** com a chave pública + JWT (RLS por empresa) |
| Back | `api/*` (funções serverless da Vercel, Node, ESM) | Usa `service_role` do Supabase (ignora RLS — **sempre filtre por `company_id`**) |
| API pública | `api/v1/[...path].js` → handlers em `api/_lib/v1handlers.js` | Autentica por `x-api-key` (tabela `company_integrations.api_key`) |
| Webhook de saída | `api/_lib/webhooks.js` → `dispatchWebhook(companyId, event, data)` | Assinado com HMAC; **não reorganize a serialização** (ver comentário no arquivo) |
| Envio de WhatsApp | `api/_lib/sendMessage.js` | Ponto único de envio; aplica o 409 (`conversation_paused`) |
| Estado da conversa | `api/_lib/conversations.js` | `automation` \| `human`; `setConversationState` |
| Entrada de WhatsApp | `api/whatsapp/[...path].js` → `handleWebhook` | Webhook da Evolution. **Área sensível** |
| Banco | Supabase, projeto `fwtnzxehfaqeklueojkp` (plano gratuito) | Multi-tenant por `company_id` |
| WhatsApp | Evolution API v2.3.7 no Railway | Uma instância por empresa: `flowmate-{company_id}` |

Tabelas que o roadmap usa: `companies`, `user_profiles`, `company_integrations`,
`crm_pipelines` (`allowed_users`), `crm_stages`, `crm_contacts` (`fields` jsonb, `tags` text[],
`external_id`), `crm_leads` (`priority`), `crm_notes` (ligada ao **contato**, não ao lead),
`custom_fields`, `conversations`, `whatsapp_messages` (só os últimos 7 dias), `whatsapp_instances`.

> Algumas tabelas (`crm_contacts`, `crm_leads`, `crm_stages`, `conversations`,
> `whatsapp_messages`, `whatsapp_instances`) foram criadas **fora** das migrações do repo.
> Por isso a primeira tarefa (P1-00) é levantar o esquema real. **Não suponha colunas.**

## 3. Regras que não podem ser quebradas

### Limites de infraestrutura
1. **Vercel Hobby = 12 funções.** Hoje há 7 arquivos em `api/` (fora `_lib`). **Não crie arquivo
   novo em `api/`.** Rotas novas da API pública entram no catch-all `api/v1/[...path].js`.
   Código auxiliar vai em `api/_lib/` (pastas com `_` não contam como função). Você pode criar
   subpastas, ex.: `api/_lib/v1/leads.js`.
2. **Catch-all fora do Next.js:** `req.query.path` pode vir `undefined`. Todo roteamento precisa
   do fallback que deriva a rota de `req.url` (já existe em `api/v1/[...path].js` — mantenha).
3. **Cron da Vercel Hobby roda 1 vez por dia.** Nada da Parte 1 depende de agendamento.

### Banco
4. **Migração antes do deploy.** Toda coluna nova precisa estar no banco **antes** do código que
   a usa ir para produção (já derrubou o webhook uma vez). Fluxo: você escreve o `.sql` →
   o Agadir roda no SQL Editor → confirma → aí você faz o push.
5. **Migração só acrescenta** na Parte 1: `add column if not exists ... default ...`,
   `create table if not exists`. Nada de `drop`, `rename` ou mudar tipo.
6. **Sempre `company_id`** em toda consulta com `adminClient()` (service_role ignora RLS).
7. O Supabase corta consultas em **1000 linhas** por padrão. Use paginação (`.range`).
8. Arquivo SQL novo na raiz, com nome `supabase_<assunto>.sql`, idempotente, com cabeçalho
   explicando o motivo e um bloco de **ROLLBACK** comentado (siga o padrão dos que já existem).

### Comportamento
9. **Parte 1 só acrescenta.** Não mude a resposta de nenhuma rota que já existe
   (`POST/GET /v1/messages`, `POST /v1/leads`, `GET/PATCH /v1/contacts`, `GET /v1/fields`,
   `POST /v1/notes`, `/api/public/lead`). Integrações de teste já dependem delas. As duas
   exceções controladas estão em `12-parte1-base-api.md` (roteador) e preservam o uso atual.
10. **Não altere `sendMessage.js` nem o fluxo de mensagens de `handleWebhook`.** Rotas novas
    de envio *chamam* `sendMessage`. As duas exceções pontuais estão descritas nas tarefas
    P1-W1 e P1-W2 e são protegidas por `try/catch`.
11. **Não reserialize o corpo do webhook de saída** (`webhooks.js` tem o porquê).
12. **Envio real de WhatsApp em teste: um único contato**, combinado com o Agadir.

### Repositório e deploy
13. Repo **público** `github.com/hdirr/flowmate`, branch `main`, **deploy automático no push**.
    Push no `main` = produção. Por isso: uma tarefa por commit, testada antes do push.
14. **Nunca** coloque chave, token ou segredo em arquivo do repo (nem em exemplo de doc).
    Use `SUA_CHAVE`, `<COMPANY_ID>`.
15. Os arquivos aparecem como "modificados" no `git status` só por quebra de linha (CRLF/LF);
    o conteúdo é igual. **Não faça commit dessas mudanças de fim de linha** junto com o seu
    trabalho — adicione só os arquivos que você alterou (`git add <arquivo>`).
16. Se existir `.git/index.lock` vazio na pasta, é sobra de uma leitura do tutor (não de outro
    processo git). Pode apagar antes de usar o git.
17. Mensagem de commit em português, prefixo `feat:`, `fix:`, `docs:` ou `chore:`, citando o ID
    da tarefa (ex.: `feat(P1-L2): GET /v1/leads com paginação`).

### Código
18. **Tela branca = variável órfã** depois de refactor. `vite build` não pega. Depois de mexer no
    front, procure referências órfãs com `grep` antes de pedir teste.
19. Siga o estilo do código existente: ESM, `async/await`, comentários em português explicando o
    **porquê**, respostas JSON com `error` em `snake_case`.
20. Nada de dependência nova no `package.json` sem perguntar ao tutor.

## 4. O que já existe na `/v1` (não quebre)

| Rota | Handler |
| --- | --- |
| `GET /v1/fields` | `handleFields` |
| `GET /v1/contacts?phone=\|id=\|external_id=` | `handleContacts` |
| `PATCH` (ou `POST`) `/v1/contacts` | `handleContacts` |
| `POST /v1/leads` (idempotente por `external_id`) | `handleLeads` |
| `GET /v1/messages?phone=&limit=` | `handleMessages` |
| `POST /v1/messages` (409 se humano) | `handleMessages` |
| `POST /v1/notes` | `handleNotes` |

A doc pública dessas rotas é o `INTEGRATIONS.md`.

## 5. Problemas conhecidos (não são tarefa sua, salvo indicação)

- Os eventos `contact.created`, `lead.created`, `lead.moved` vindos da **tela** são disparados
  pelo navegador (`src/lib/store.js` → `/api/integrations/emit`). Mover para o servidor é a
  Parte 2 (bloco 2). Na Parte 1 só fechamos o abuso dessa rota (P1-S4).
- As **automações** (`flowmate_workflows`) rodam **no navegador** (`runAutomations` em
  `store.js`). Por isso um lead criado pela API **não dispara automação**. É limitação
  conhecida; documente-a, não tente resolver (Parte 2, bloco 16).
- `GET /v1/contacts` e `GET /v1/messages` montam o JID com `digits(phone)` sem prefixar `55`,
  enquanto o resto do sistema usa `jidFor()` (que prefixa). Telefone salvo sem `55` não acha a
  conversa. Corrigido na tarefa P1-E0 (opcional, com aprovação).
- `sendMessage.js` não verifica erro do insert em `whatsapp_messages`.
- `custom_fields`: a migração do repo criou a coluna `field_type`, mas `handleFields` seleciona
  `type`. Confirme qual existe no P1-00.
