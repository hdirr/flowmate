# 35 — Parte 2: demais blocos (DESENHO resumido)

> Não implementar sem liberação do Agadir. Cada bloco será detalhado (como os arquivos 31–34)
> quando for liberado. Aqui está o suficiente para você comentar e estimar.

## Bloco 6 — Equipes (se aprovado)
Tabelas `teams` (nome, padrão) e `team_members` (usuário, é supervisor). `conversations.team_id`.
Transferir para equipe → conversa fica `pending` na fila da equipe. Distribuição automática
(rodízio entre membros disponíveis) como opção da equipe, rodando no tick do bloco 4. API
`GET /v1/teams`, `type: 'team'` no transfer.

## Bloco 7 — Status de mensagem (entregue / lida) ⚠ mexe no webhook do WhatsApp
- Acrescentar `MESSAGES_UPDATE` à lista de eventos do `webhookConfig()` em
  `api/whatsapp/[...path].js` (usada no `connect` e no `sync`). Depois do deploy, o Agadir clica
  em **Importar conversas** para a Evolution receber a configuração nova.
- Novo ramo em `handleWebhook` para `messages.update`: atualiza `whatsapp_messages.status`
  (`sent` → `delivered` → `read`; nunca regride) pelo `message_id`. Ramo **separado**, sem tocar no
  de `messages.upsert`.
- **Antes de codar:** capturar um payload real de `messages.update` da Evolution v2.3.7 (logar em
  produção por um dia, só o formato) — os nomes de campo variam entre versões.
- Evento `message.updated` `{ message_id, conversation_id, status }`;
  `GET /v1/messages/{id}/status`; opcional `callbackUrl` por envio (como a Helena).
- Fazer só com o `WEBHOOK_SECRET` já configurado (P1-S3) e smoke test de recebimento.

## Bloco 8 — Envios avançados
Áudio (gravado como nota de voz), apagar para todos, "digitando", responder citando
(`quoted`), atraso de digitação antes de enviar. Cada um é uma chamada diferente da Evolution
v2 — **confirmar o endpoint e o corpo na documentação da v2.3.7** antes (o grupo já mostrou que
a v2 muda nomes de campo: `subject` x `groupName`). Tudo passa por `sendMessage` ou por uma função
irmã com a mesma regra do 409.

## Bloco 9 — Modelos de mensagem
Tabela `message_templates` (nome, texto com variáveis `{{nome}}`, `{{primeiro_nome}}`,
`{{campo:Convênio}}`, mídia opcional, ativo). Tela em Configurações. Seletor de modelo no Chats e
nas automações. API `GET /v1/templates` e `template_id` + `variables` no envio. Variável sem
valor → envio recusado com erro claro (não manda `{{nome}}` literal).

## Bloco 10 — Mensagens agendadas
Tabela `scheduled_messages` (destino, conversa, texto ou modelo, mídia, `send_at`, status
`scheduled/sent/failed/canceled`, motivo da falha, quem criou). Execução por job do bloco 4.
Tela: agendar no Chats + lista em Apps. API `GET/POST /v1/scheduled-messages`,
`GET/PATCH /v1/scheduled-messages/{id}`, `POST .../cancel`, `POST .../batch-cancel` (mesmos
nomes da Helena). Eventos `scheduled.sent`, `scheduled.failed`. Decisões: modo humano, texto livre.

## Bloco 11 — Sequências
Tabelas `sequences` (nome, passos com intervalo e janela de horário, para quando o contato
responder?) e `sequence_enrollments` (contato, passo atual, próximo envio, status). Execução por
job. Métricas por passo (enviadas, lidas, responderam) dependem do bloco 7. API: listar, inscrever
e remover contato (um e em lote), como na Helena. Ação de automação "inscrever na sequência".

## Bloco 12 — Chatbots no n8n
- Tabela `bots` (nome, URL do fluxo no n8n, segredo, ativo).
- **Bot padrão por número:** em Configurações, escolher qual bot atende conversas novas em
  automação. `message.received` de uma conversa com bot vai para a URL do bot (além das
  assinaturas normais).
- **Bot sob demanda:** `POST /v1/chatbots/{id}/start` `{ conversation_id | phone,
  skip_if_bot_running, skip_if_in_progress }` (opções da Helena) → `conversations.bot_id`.
- Bot devolve a conversa: `PATCH /v1/conversations/{id}` (`state: human`) ou
  `POST .../transfer`, já existentes/planejados.
- Eventos `bot.started`, `bot.finished`.

## Bloco 13 — Várias chaves de API + limite de requisições
- Tabela `api_keys` (nome, hash da chave, último uso, criada por, revogada em). Mostrar a chave só
  na criação; guardar só o hash. Migrar a chave atual de `company_integrations`.
- Limite (referência Helena: 1.000 req / 5 min e 200 req / 5 s por conta, resposta 429). A
  Vercel não guarda contador entre execuções; opções: tabela no Supabase com janela por minuto
  (simples, custa uma escrita por requisição) ou serviço externo (exige dependência e conta —
  perguntar ao tutor).

## Bloco 14 — Opcionais
Horário de atendimento (mensagem automática fora do horário, usado pelos bots e campanhas);
vários números por empresa (multi-linha — muda a chave `flowmate-{company_id}` da instância, é
grande); subcontas para revenda (painel de parceiro, como os endpoints de "Contas" da Helena);
nó próprio do FlowMate para n8n (pacote npm de *community node*, como o `n8n-nodes-wts` da
Helena — só faz sentido depois que a API estabilizar).
