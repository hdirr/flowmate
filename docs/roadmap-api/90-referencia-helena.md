# 90 — Referência: API da Helena CRM

Lida inteira em 01/10/2026 (119 operações + guias), em https://helena.readme.io/llms.txt.
O sistema web (IVE CRM, marca própria sobre a Helena, `ivecrm.wts.chat`) foi revisado só olhando.
Use para comparar nomes e comportamentos; **o FlowMate não precisa copiar tudo**.

## Convenções da Helena
- Base `https://api.helena.run`, dividida por domínio: `/core` (contas, contatos, usuários,
  equipes, webhooks), `/chat` (conversas, mensagens, envios, bots, agendadas, sequências,
  modelos), `/crm` (painéis e cards).
- Autenticação: `Authorization: Bearer pn_...`; vários tokens nomeados, criados e revogados pelo
  cliente.
- Paginação: `pageNumber` + `pageSize` (máx. 100); resposta `pageNumber, pageSize, totalPages,
  totalItems, hasMorePages, items`. Filtros de data `CreatedAt.Before/After`, `UpdatedAt.Before/After`.
- Limite: 1.000 req / 5 min e 200 req / 5 s por conta → 429. O guia ensina usar Wait e retry no n8n.
- Webhook: envelope `{ eventType, date, content }`; assinaturas múltiplas com nome, URL, eventos,
  ativa/inativa. A documentação **não** mostra assinatura HMAC.
- n8n: *community node* `n8n-nodes-wts` ("wts chat"), só para n8n auto-hospedado. As listas de
  ações "Session actions" e "Message actions" que o Agadir mostrou são desse nó.

## Eventos de webhook (18)
SESSION_NEW, SESSION_UPDATE, SESSION_COMPLETE, MESSAGE_RECEIVED, MESSAGE_UPDATED, MESSAGE_SENT,
CONTACT_NEW, CONTACT_UPDATE, CONTACT_TAG_UPDATE, PAYMENT_NEW, PAYMENT_UPDATE, PANEL_CARD_NEW,
PANEL_CARD_UPDATE, PANEL_CARD_STEP_CHANGE, PANEL_CARD_NOTE_NEW, PANEL_CARD_NOTE_UPDATE,
TEMPLATE_NEW, TEMPLATE_UPDATE.

## Operações por grupo (resumo)

| Grupo | Operações |
| --- | --- |
| Contatos | `GET/POST /core/v1/contact` (criar com `upsert`, `getIfExists`), `POST /contact/filter`, `GET/PUT /contact/phonenumber/{phone}`, `GET /contact/{id}`, `PUT /core/v2/contact/{id}`, tags por id e por telefone (`InsertIfNotExists/DeleteIfExists/ReplaceAll`), `POST /core/v2/contact/batch`, campos personalizados. Contato tem `status` ACTIVE/ARCHIVED/BLOCKED, `origin`, `utm`, `metadata`, carteiras, sequências |
| Etiquetas | listar, criar, atualizar, excluir (com `removeFromContacts`), cores |
| Usuários (agent) | listar, criar (perfil Admin/Agent/RestrictedAgent), atualizar, excluir (com destino das conversas), equipes, status, logout |
| Equipes | criar (distribuição automática, restrição, canais), listar, obter, atualizar, excluir, membros |
| Carteiras | listar; adicionar/remover contato (um e em lote) |
| Conversas (session) | `GET /chat/v2/session` (filtros status, equipe, usuário, tags, canal, contato, datas, metadata), obter, `PUT /transfer` (DEPARTMENT/USER), `PUT /assignee`, `PUT /complete` (`reactivateOnNewMessage`, `stopBotInExecution`), `PUT /status` (STARTED/PENDING/IN_PROGRESS/COMPLETED/HIDDEN), `PUT /v2/session/{id}/partial` (classificação WON/LOST/INFO/OTHER + valor, metadata), mensagens da conversa (listar, enviar, enviar síncrono), notas internas |
| Envios | `POST /chat/v1/message/send` (assíncrono, com status), `send-sync`, e por tipo `/send/text|image|audio|video|document|template|template/batch|chatbot|otp|typing` com opções `enableBot`, `forceStartSession`, `hiddenSession`, usuário/equipe, `delayTyping`, `refId` (citar), `callbackUrl` |
| Mensagens | listar por conversa, obter, status (PROCESSING, QUEUED, SENT, DELIVERED, READ, FAILED, DELETED, WAIT_REPLY), excluir |
| Agendadas | listar, criar (tipo TEMPLATE ou CHATBOT), obter, atualizar, cancelar, cancelar em lote. Status SCHEDULED, PROCESSED, SENT, DELIVERED, READ, CANCELED, FAILED |
| Modelos | listar |
| Sequências | listar; adicionar/remover contato (um e em lote); listar contatos |
| Chatbots | listar; disparar (`skipIfBotInExecution`, `skipIfInProgress`, metadata, `callbackUrl`) |
| Painéis (CRM) | listar painéis, obter, campos, motivos de perda |
| Cards | listar (filtro painel, etapa, contato, responsável, status), criar (etapa, título, descrição, posição, vencimento, responsável, tags, contatos, conversa, valor, campos, metadata), obter, `PUT /crm/v3/panel/card/{id}` (+ status OPEN/WON/LOST/ARCHIVED e motivo de perda), duplicar, notas (listar, criar, remover) |
| Webhooks | listar eventos; assinaturas: listar, criar, obter, atualizar, remover |
| Arquivos | URL de upload + salvar |
| Contas / parceiros | subcontas (criar, ativar, tokens), relatório de faturamento |
| Outros | canais, horário de atendimento |

## O que só aparece na tela (IVE CRM)
- **Atendimentos:** filas Novos / Meus / Outros, "apenas não lidos", etiqueta do bot e da equipe.
- **Painéis:** tipos Vendas e Gestão (tarefas); visões Kanban, Lista, Relatório; exportar; card
  com código (`FDV-1`), anotações com anexo e histórico.
- **Campanhas:** disparo em massa (rascunho → agendada → processando → concluída/pausada/
  cancelada/falha) com relatório. Não existe na API.
- **Chatbots:** de atendimento (padrão de cada canal) e de automação (disparado na conversa,
  sequência, campanha ou API). Construtor visual com nó de webhook (a resposta escolhe o caminho,
  atualiza o contato, manda mensagens, monta perguntas com botões/lista/números).
- **Apps (módulos liga/desliga, alguns pagos):** tempo de segurança antes de enviar,
  classificação de atendimento, cobrança Asaas (R$ 89,90/mês), distribuição automática, chat
  interno, carteirização, transcrição de áudio (R$ 7,90/usuário/mês), agentes de IA
  (R$ 199,90/mês), grupos, pesquisa CSAT (R$ 29,90/mês), campanhas, sequências, agendadas.
- **Relatórios:** indicadores, atendimentos, CSAT, consumo de infraestrutura.
- **Integrações:** widget do site, webhooks, API, Make.com, n8n.
