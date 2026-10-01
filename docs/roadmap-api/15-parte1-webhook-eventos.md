# 15 — Parte 1: eventos de webhook e documentação (P1-W*, P1-Z)

Os eventos `contact.updated`, `contact.tags_updated`, `lead.updated` e `note.created` já saem
das próprias rotas novas (P1-E*). Aqui ficam os dois eventos que nascem em código compartilhado,
a tela e a documentação.

Todo `dispatchWebhook` novo vai dentro de `try/catch` que só loga: **um problema no webhook do
cliente nunca pode derrubar a ação principal.**

---

## P1-W1 — `conversation.state_changed`

**Arquivos:** `api/_lib/conversations.js` (`setConversationState`) e `api/conversations/state.js`.

`setConversationState` é chamada por quatro caminhos:

| Quem chama | Arquivo | `changed_by` |
| --- | --- | --- |
| Atendente envia pela tela (vira humano) | `api/_lib/sendMessage.js` | `user` (tem `actorUserId`) |
| Dono responde pelo celular | `api/whatsapp/[...path].js` (`handleWebhook`) | `phone` (`actorUserId` nulo) |
| Botão "devolver para automação" / pausar | `api/conversations/state.js` | `user` |
| API (P1-E6) | `api/_lib/v1/conversations.js` | `api` |

**Fazer:**
1. Nova assinatura, compatível com as chamadas atuais:
   `setConversationState(conversationId, state, actorUserId = null, source = null)`.
2. Dentro: ler a conversa atual (`company_id, contact_id, remote_jid, state`) antes do update.
   Depois do update, se o estado mudou, disparar o evento com
   `changed_by = source || (actorUserId ? 'user' : 'phone')`.
3. Em `api/conversations/state.js` passar `source = 'user'` (hoje, ao devolver para automação,
   o `actorUserId` vai nulo e seria lido como `phone`).
4. **Não edite** `sendMessage.js` nem `handleWebhook`: a regra do item 2 já dá o valor certo
   para eles. Esta é uma das duas exceções da Parte 1: o código novo **roda** dentro do fluxo
   de mensagens (caminho "respondeu pelo celular"), por isso o `try/catch` é obrigatório.

**Teste:** pausar e devolver pela tela; responder pelo celular numa conversa de teste em
automação; `PATCH` pela API. Cada um gera um evento com o `changed_by` certo.
Recebimento de mensagens continua normal (smoke test).

---

## P1-W2 — `whatsapp.connection` ⛔ (depois do P1-S3)

**Arquivo:** `api/whatsapp/[...path].js`, **só** o ramo `event === 'connection.update'` de
`handleWebhook`.

1. Antes do `upsert` que já existe, ler o `status` atual de `whatsapp_instances` da empresa.
2. **Não mude** o `upsert` nem o mapeamento atual (`open` → `connected`, resto → `disconnected`).
3. Depois do `upsert`: só se o estado recebido for `open` ou `close` **e** o status mapeado for
   diferente do anterior, disparar `whatsapp.connection`
   `{ status, phone, instance: instanceName }`. Ignorar `connecting` (a Evolution manda muitos).
4. `try/catch` em volta do passo 1 e do 3.

Para que serve: o n8n do cliente pode avisar alguém quando o número cair.

**Teste:** o Agadir desconecta e reconecta o número de teste (Configurações → WhatsApp). Saem um
`disconnected` e um `connected`, sem repetição.

---

## P1-W3 — Eventos novos na tela de Integrações

**Arquivo:** `src/pages/Settings.jsx`, constante `OUTBOUND_EVENTS`.

1. Acrescentar os eventos novos com rótulo em português (mesma ordem de `api/_lib/events.js`),
   com comentário dizendo que a lista oficial está em `api/_lib/events.js`.
2. Conferir que `GET /v1/webhook-events` e a tela mostram a mesma lista.

**Atenção (documentar na P1-Z):** empresa que deixou **nenhum** evento marcado recebe **todos**,
então passa a receber os novos tipos. O n8n deve sempre rotear pelo campo `event`. Hoje não há
cliente ativo, então não quebra ninguém.

---

## P1-Z — Documentação final da Parte 1

1. **`INTEGRATIONS.md`:**
   - Autenticação com `Authorization: Bearer`.
   - Seção "Convenções": paginação, formato de erro, datas, os 7 dias de mensagens.
   - Todas as rotas novas, com exemplo `curl` (chave `SUA_CHAVE`) e exemplo de resposta.
   - Tabela de eventos completa (com os novos e seus `data`).
   - Limitação: ações pela API não disparam as automações da tela.
   - Regra nova: com nenhum evento marcado, chegam todos, inclusive os que forem criados depois.
   - Atualizar o bloco "Planejado — ainda não disponível" com o que continua faltando.
2. **`HANDOFF.md`:** seção curta "API v1 — Parte 1 concluída" listando rotas, eventos, SQL
   rodado (`supabase_metadata.sql`) e o que ficou adiado.
3. Relatório `relatorios/P1-Z.md` com a lista de todos os commits da Parte 1.
