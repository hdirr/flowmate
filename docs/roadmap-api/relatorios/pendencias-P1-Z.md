# Pendências acumuladas para a P1-Z

Lista única do que os relatórios deixaram para a documentação final da Parte 1 (P1-Z).
Cada item cita o relatório de origem.

## Documentar no `INTEGRATIONS.md`
- **Chave:** `x-api-key` e `Authorization: Bearer` não devem ser enviados juntos. Vale o
  primeiro preenchido, na ordem `x-api-key` → `Bearer` → `?key=`. (P1-B2)
- **Bearer:** o Bearer da /v1 é a chave da integração, não o JWT do Supabase. (P1-B2)
- **Filtro `tag` do `GET /v1/contacts`:** é exato e diferencia maiúsculas (`teste-api` ≠
  `TESTE-API`; `teste` não casa com `teste-api`). O `name` é "contém", sem diferenciar caixa.
  (P1-L4)
- **Valor do lead:** `value` vem 0 até a Parte 2 (bloco 1). A coluna existe, mas o app ainda não
  mostra nem edita. (P1-L3)
- **Campos personalizados:** os valores de `fields` chegam como texto, inclusive em campo
  `number` (a tela grava string). (P1-00c)
- **Automações:** ações feitas pela API não disparam as automações da tela. Os webhooks disparam
  normalmente. (`14`)
- **Conversas:** `updated_at` de conversa = "última mudança de estado", não "última mensagem".
  Já está no `20-contrato-api-v1.md` (P1-L6). (resposta do tutor à P1-00)
- **Conversas em `human`:** não disparam `message.received` até alguém retomar a automação pela
  tela ou pela API (a rota de estado vem na P1-E6). A pausa não expira sozinha. (P1-L6)
- **`@lid`:** conversa com JID `@lid` é `individual`, mas `phone` vem `null`, porque o `@lid` não
  é telefone. (P1-L6)
- **`contact` da conversa** vem só por `contact_id`; hoje a maioria das conversas sai com
  `contact: null`. (P1-L6)

## Para a Parte 2 (registrado nos relatórios, não é da P1-Z)
- **Bloco 5 (conversas):** a pausa (`human`) não expira. Avaliar retorno automático para
  `automation`, por tempo sem resposta humana ou ao encerrar o atendimento, como a Helena faz ao
  fechar a sessão. (P1-L6)
- **Conversas `@lid`:** as 4 conversas `@lid` não têm nenhuma mensagem gravada (nem por JID nem
  por `conversation_id`). Verificar se o mesmo contato tem outra conversa `@s.whatsapp.net`
  (duplicada) ou se só não há mensagens. (P1-L7)
- **Contato da conversa:** a API usa só `contact_id`, enquanto a tela de Chats casa pelos
  últimos 8 dígitos do telefone. Sugestão: preencher `conversations.contact_id` quando o contato
  for criado ou atualizado com telefone que bate, e uma rotina única para preencher os antigos.
  (P1-L6)
- **Eventos:** empresa com nenhum evento marcado recebe todos, inclusive os criados depois.
  (`15`)

## Decisões para etapas da Parte 1
- **P1-W3 (tela de Integrações):** a lista de eventos da tela passa a ler o catálogo
  `api/_lib/events.js` (fonte única com o `GET /v1/webhook-events`) e mostra **só os eventos com
  `available: true`**. Até lá, a tela mantém a lista própria (`OUTBOUND_EVENTS` em
  `Settings.jsx`), com os mesmos 5 eventos da v1. (decisão do tutor na P1-L10)

- **P1-W1:** a pausa pela API grava `state_by` nulo (igual à do celular). Decisão: manter a coluna
  e distinguir pelo parâmetro `source` de `setConversationState`, que vira `changed_by`
  (`api`/`phone`/`user`) no evento `conversation.state_changed`. (decisão do tutor no bloco do
  tester)
- **P1-Z, tags:** hoje as tags diferenciam maiúsculas (`VIP` ≠ `vip`) na tela, no filtro da L4 e
  na E3. Decidir na P1-Z se normaliza (e como migrar as existentes) ou se mantém e só documenta.
  (decisão do tutor no bloco do tester)
- **P1-E0 (junto):** `toWhatsAppNumber` acrescenta `55` a qualquer número de 10–11 dígitos;
  número estrangeiro sem código do país iria para um número brasileiro errado no
  `POST /v1/messages` antigo e no `sendMessage`. A E7 se protege (422); a rota antiga não.
  (P1-E7)
- **P1-E7, envio real:** aguardando o Agadir confirmar a conversa de teste (número dele) para 1
  envio real + o teste do 409. (P1-E7)
- **409 `conversation_paused`, teste pendente:** o tutor pediu o teste só no contato `smoke-001`,
  mas ele **não tem telefone nem conversa** (verificado em 2026-10-02). Não testado; aguarda o
  Agadir indicar uma conversa de teste segura (número de teste dele).
- **P1-E5 (`POST /v1/leads/{id}/notes`):** testar ali a **nota com autor** (`user_id`
  preenchido) no `GET /v1/leads/{id}/notes`: só a tela cria nota com autor e não havia nenhuma
  na P1-L11. Uma nota escrita pela tela no contato `smoke-001` serve. (decisão do tutor na
  P1-L11)

## Corrigir no `HANDOFF.md`
- `supabase_whatsapp_cache.sql` **foi** rodada (`whatsapp_instances.updated_at` existe, com
  gatilho). (P1-00)
- Não existem colunas `asaas_*` em `companies`. (P1-00)
- `supabase_abacate.sql` rodada (colunas `abacate_*` existem). (P1-00)
- `ABACATEPAY_WEBHOOK_SECRET` está configurada na Vercel. (P1-S1)
- Trava de assinatura agora fecha com status desconhecido; Onboarding só orienta a assinar.
  (P1-S2)

## Segurança (fora da P1-Z, mas registrar no HANDOFF)
- **Chave da Evolution fraca, troca agendada com o Agadir.** P1-S3 e P1-W2 bloqueadas até a
  troca de `EVOLUTION_API_KEY` e a criação do `WEBHOOK_SECRET`. (P1-S5)
- **Fim da Parte 1:** o Agadir troca o `VERCEL_BYPASS_TOKEN` (Vercel → Deployment Protection →
  Protection Bypass for Automation) junto com as outras chaves. (P1-B3)
- **Fim da Parte 1:** o Agadir regenera a chave de teste da API e atualiza `FLOWMATE_TEST_KEY`;
  limpar de novo o allowlist (`.claude/settings.local.json`) se aparecer algum valor. (P1-S6)

## Revisão de segurança (futura)
- Evidências da P1-L7 (commits 1ff3aac e 715d42c, 9 arquivos listados no relatório) usam SHA-256
  sem chave, reversível por força bruta; ~190 telefones de contatos expostos enquanto o repo foi
  público. Repo tornado privado em 2026-10-01. Pendente: reescrever histórico, regenerar
  evidências com pseudônimos não derivados, avaliar cache/forks no GitHub.
  (Versões brutas e o script `l7mask.js` mantidos só no scratchpad local, fora do repo, até a
  revisão.)
- Refazer o teste de isolamento entre empresas com dado real quando houver uma segunda empresa
  com dados. Hoje só a empresa `98997d76…` tem mensagens (P1-L9) e a IVE não tem leads (P1-L3).
  O isolamento está garantido pelo filtro `company_id` em todas as consultas da /v1, mas só foi
  testado com ids inexistentes.

## Lista de limpeza (dados de teste)
- Campo personalizado `Teste API` e os campos `Nome Faixada`, `ID`, `Nascimento`, `Opcão`.
  (P1-00b, P1-00c)
- Valores desses campos no contato "Teste 409". (P1-00b, P1-00c)
- Contato "Smoke Test FlowMate" (`external_id` `smoke-001`), com lead. (P1-00b)
- Tag `teste-api` no contato `smoke-001`. (P1-L4)
- 2 notas de teste ("Nota de teste P1-L11 n1/n2") no contato `smoke-001`. (P1-L11)
- 2 notas de teste ("Nota de teste P1-E5 sem autor/com autor") no contato `smoke-001`. (P1-E5)
- 2 notas de teste ("Nota de teste E5-fix sem autor/com autor") no contato `smoke-001`. (P1-E5, correção)
- Contatos "Teste S4" e "Teste S4b". (P1-S4)
- Usuário de teste "hhhh" (vendedor, inativo) da empresa FlowMate; confirmado como teste pelo
  Agadir. (P1-L5/L6)
- Link do webhook.site em Configurações → Integrações (`5e03e930…`): **público e expira em 7
  dias**. Tirar ao fim dos testes. (P1-S4)
- Itens que já estavam no HANDOFF: contatos "Teste 409" e "Teste Idempotencia", cobranças de
  teste no AbacatePay, linhas de teste em `pending_signups`.
