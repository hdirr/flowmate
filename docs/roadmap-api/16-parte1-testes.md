# 16 — Parte 1: roteiro de testes

Comandos em bash (Git Bash no Windows). No PowerShell use `curl.exe` e aspas duplas escapadas.

**Chave de teste:** fica na variável de usuário do Windows `FLOWMATE_TEST_KEY` (o Agadir cria e
atualiza). **Nunca escreva o valor da chave num comando**: o comando pode ficar salvo no
allowlist do Claude Code (`.claude/settings.local.json`). Cada comando do Claude Code abre um
terminal novo, então leia a variável no início do próprio comando e confira só o tamanho:

```bash
# Se o processo já herdou a variável, ela vem direto; senão, lê do registro do usuário.
[ -n "$FLOWMATE_TEST_KEY" ] || FLOWMATE_TEST_KEY=$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('FLOWMATE_TEST_KEY','User')" | tr -d '\r\n')
echo "tamanho: ${#FLOWMATE_TEST_KEY}"   # 32 esperado; vazio → pare e avise o Agadir
KEY="$FLOWMATE_TEST_KEY"
BASE="https://flowmate-ashy.vercel.app"
TEST_PHONE="<telefone do contato de teste combinado com o Agadir>"
```

Se algum comando com o valor da chave aparecer no allowlist, remova na hora e registre no
relatório. No fim da Parte 1 o Agadir regenera a chave e atualiza a variável.

Para ver os webhooks de saída chegando, o Agadir aponta Configurações → Integrações → URL para um
fluxo de teste no n8n dele (nó Webhook) ou outro receptor que ele escolher. Peça a ele os
payloads recebidos quando a tarefa gerar evento.

---

## 1. Smoke test (rodar depois de **todo** deploy)

O que já existia tem de responder igual. Se algo falhar: `git revert` do seu commit, push, e relate.

```bash
# 1.1 Campos
curl -s "$BASE/v1/fields" -H "x-api-key: $KEY"                       # 200 { fields: [...] }

# 1.2 Contato por telefone (rota antiga)
curl -s "$BASE/v1/contacts?phone=$TEST_PHONE" -H "x-api-key: $KEY"   # 200 { contact, lead, conversation } ou 404 contact_not_found

# 1.3 Histórico (rota antiga)
curl -s "$BASE/v1/messages?phone=$TEST_PHONE&limit=5" -H "x-api-key: $KEY"   # 200 { conversation, messages }

# 1.4 Lead idempotente (rota antiga) — rode duas vezes: a 2ª tem de vir created:false
curl -s -X POST "$BASE/v1/leads" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"external_id":"smoke-001","name":"Smoke Test FlowMate"}'

# 1.5 Chave inválida
curl -s "$BASE/v1/fields" -H "x-api-key: errada"                     # 401 { error: "invalid_api_key" }

# 1.6 Rota inexistente
curl -s "$BASE/v1/naoexiste" -H "x-api-key: $KEY"                    # 404 { error: "not_found", route }

# 1.7 Rotas do WhatsApp (sem login) — roteamento intacto
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/whatsapp/connect"         # 405
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/whatsapp/qualquer_coisa"  # 404
```

**1.8 Manual (peça ao Agadir):** mandar uma mensagem de WhatsApp para o número da empresa e ver
que ela aparece no Chats em até alguns segundos. Obrigatório depois de P1-W1, P1-S3 e P1-W2.

O contato "Smoke Test FlowMate" fica na lista de limpeza do `HANDOFF.md`.

---

## 2. Por tarefa

### P1-S1
```bash
curl -s -X POST "$BASE/api/billing/webhook" -H "Content-Type: application/json" -d '{"event":"billing.paid","data":{"id":"x"}}'
# sem variável na Vercel → 503 webhook_not_configured ; com variável e sem segredo → 401
```

### P1-S2
Manual (Agadir): login com a empresa dele abre o app normalmente. Usuário de teste sem empresa
(se existir) vê a tela "assine um plano", não um erro.

### P1-S3 ⛔
```bash
curl -s -X POST "$BASE/api/whatsapp/webhook" -H "Content-Type: application/json" -d '{"event":"messages.upsert"}'
# → 401 (ou 503 se a variável sumir). Depois: smoke 1.8.
```

### P1-S4
Com o JWT do Agadir (ele copia do navegador, aba Rede, header `Authorization` de uma chamada `/api/...`):
```bash
JWT="<jwt>"
curl -s -X POST "$BASE/api/integrations/emit" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"event":"pagamento.falso","data":{}}'                                       # 400 event_not_allowed
curl -s -X POST "$BASE/api/integrations/emit" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"event":"lead.moved","data":{"lead_id":"00000000-0000-0000-0000-000000000000"}}'  # 404 not_found
```
E na tela: criar um contato → o webhook de teste recebe `contact.created` com os dados do banco.

### P1-B1 / P1-B2
Smoke test inteiro. Mais:
```bash
curl -s "$BASE/v1/fields" -H "Authorization: Bearer $KEY"     # igual ao 1.1
```

### P1-L*
```bash
curl -s "$BASE/v1/pipelines" -H "x-api-key: $KEY"
curl -s "$BASE/v1/leads?pageSize=2" -H "x-api-key: $KEY"                      # hasMorePages coerente
curl -s "$BASE/v1/leads?pageSize=2&pageNumber=2" -H "x-api-key: $KEY"
curl -s "$BASE/v1/leads/<lead_id>" -H "x-api-key: $KEY"
curl -s "$BASE/v1/leads/00000000-0000-0000-0000-000000000000" -H "x-api-key: $KEY"   # 404 lead_not_found
curl -s "$BASE/v1/leads/nao-e-uuid" -H "x-api-key: $KEY"                     # 404, não 500
curl -s "$BASE/v1/leads?createdAfter=ontem" -H "x-api-key: $KEY"             # 400 invalid_date
curl -s "$BASE/v1/contacts?pageSize=5&name=smoke" -H "x-api-key: $KEY"
curl -s "$BASE/v1/users" -H "x-api-key: $KEY"
curl -s "$BASE/v1/conversations?type=individual&pageSize=5" -H "x-api-key: $KEY"
curl -s "$BASE/v1/conversations/<conversation_id>" -H "x-api-key: $KEY"
curl -s "$BASE/v1/conversations/<conversation_id>/messages?pageSize=5&order=asc" -H "x-api-key: $KEY"
curl -s "$BASE/v1/messages/<message_id>" -H "x-api-key: $KEY"
curl -s "$BASE/v1/webhook-events" -H "x-api-key: $KEY"
curl -s "$BASE/v1/leads/<lead_id>/notes" -H "x-api-key: $KEY"
```
Para cada uma: um id de **outra empresa** precisa dar 404. Se não houver outra empresa, crie um
UUID aleatório e confirme 404.

### P1-E*
```bash
# E2 — criar (201), repetir = atualiza como hoje (200 created:false), repetir com upsert:false (409)
curl -s -X POST "$BASE/v1/contacts" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Teste API Contato","external_id":"p1-e2-001","metadata":{"origem":"teste"}}'   # 201 created:true
curl -s -X POST "$BASE/v1/contacts" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Teste API Contato 2","external_id":"p1-e2-001"}'                        # 200 created:false, nome mudou
curl -s -X POST "$BASE/v1/contacts" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Outro","external_id":"p1-e2-001","options":{"upsert":false}}'          # 409 contact_exists
# Apelido antigo: POST com phone de contato existente continua atualizando
curl -s -X POST "$BASE/v1/contacts" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$TEST_PHONE\",\"name\":\"<nome atual do contato de teste>\"}"     # 200 como hoje

# E3 — tags
curl -s -X POST "$BASE/v1/contacts/<contact_id>/tags" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"tags":["teste-api"],"operation":"InsertIfNotExists"}'

# E4 — mover lead
curl -s -X PATCH "$BASE/v1/leads/<lead_id>" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"stage_name":"<nome de uma etapa>","priority":true,"metadata":{"origem":"teste"}}'

# E5 — nota
curl -s -X POST "$BASE/v1/leads/<lead_id>/notes" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"text":"Nota de teste da API"}'

# E6 — estado (use a conversa do contato de teste)
curl -s -X PATCH "$BASE/v1/conversations/<conversation_id>" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"state":"human"}'
curl -s -X PATCH "$BASE/v1/conversations/<conversation_id>" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"state":"automation"}'

# E7 — enviar (SÓ para o contato de teste)
curl -s -X POST "$BASE/v1/conversations/<conversation_id>/messages" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"Teste P1-E7"}'
# Com a conversa em human → 409 conversation_paused
```
Confira na tela do FlowMate que cada mudança aparece (contato, tag, etapa, nota, badge do
estado no Chats) e peça ao Agadir o payload de cada evento recebido.

Dados de teste criados aqui (contatos "Teste API...", tag `teste-api`) vão para a lista de
limpeza do `HANDOFF.md`.
