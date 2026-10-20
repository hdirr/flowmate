// Catálogo oficial dos eventos de webhook de saída — FONTE ÚNICA. Usado pelo
// GET /v1/webhook-events (P1-L10) e pela tela de Integrações (src/pages/Settings.jsx, P1-W3),
// que mostra só os eventos com available: true. Este arquivo é importado também pelo front:
// mantenha-o sem dependências de Node.
//
// available: o evento já é emitido hoje? available_after: a etapa do roteiro de que ele
// depende (null quando já sai). Atualize os dois na tarefa que passar a emitir o evento —
// assim o cliente não assina, sem saber, um evento que ainda nunca chega.
// label/hint: texto curto da tela (a API devolve description).
// feature: chave da empresa (companies.features) sem a qual o evento nunca sai. A tela de
// Integrações só mostra o evento com a chave ligada; a API devolve requires_feature.
export const WEBHOOK_EVENTS = [
  { event: 'message.received',          description: 'Cliente mandou mensagem (sem etiquetas: só com a conversa em automação; com a chave labels: sempre, com labels e state)', since: 'v1', available: true,  available_after: null,
    label: 'Mensagem recebida', hint: 'com etiquetas: sempre, com as etiquetas da conversa' },
  { event: 'message.sent',              description: 'O FlowMate enviou uma mensagem', since: 'v1', available: true,  available_after: null,
    label: 'Mensagem enviada', hint: 'inclui o campo sender (human | automation)' },
  { event: 'contact.created',           description: 'Contato criado', since: 'v1', available: true,  available_after: null,
    label: 'Contato criado' },
  { event: 'lead.created',              description: 'Lead criado', since: 'v1', available: true,  available_after: null,
    label: 'Lead criado' },
  { event: 'lead.moved',                description: 'Lead mudou de etapa ou de funil', since: 'v1', available: true,  available_after: null,
    label: 'Lead mudou de etapa' },
  // novos da Parte 1:
  { event: 'contact.updated',           description: 'Contato existente alterado pelo POST /v1/contacts', since: 'p1', available: true,  available_after: null,
    label: 'Contato alterado', hint: 'pela API (POST /v1/contacts)' },
  { event: 'contact.tags_updated',      description: 'Tags do contato alteradas pela API', since: 'p1', available: true,  available_after: null,
    label: 'Tags do contato alteradas', hint: 'pela API (adicionadas e removidas)' },
  { event: 'lead.updated',              description: 'Lead alterado pela API', since: 'p1', available: true,  available_after: null,
    label: 'Lead alterado', hint: 'pela API (etapa, prioridade, valor, metadata)' },
  { event: 'note.created',              description: 'Nota interna criada pela API', since: 'p1', available: true,  available_after: null,
    label: 'Nota criada', hint: 'pela API' },
  { event: 'conversation.state_changed',description: 'Conversa mudou entre automação e humano', since: 'p1', available: true,  available_after: null,
    label: 'Conversa mudou de estado', hint: 'automação ↔ humano (tela, celular ou API)' },
  // Etiquetas (PLANO-ETIQUETAS, ET-2/ET-4): só com a chave labels ligada.
  { event: 'label.created',             description: 'Etiqueta criada (tela ou API)', since: 'labels', available: true, available_after: null, feature: 'labels',
    label: 'Etiqueta criada', hint: 'tela ou API' },
  { event: 'label.updated',             description: 'Etiqueta renomeada ou com cor nova (tela ou API)', since: 'labels', available: true, available_after: null, feature: 'labels',
    label: 'Etiqueta alterada', hint: 'nome ou cor' },
  { event: 'label.deleted',             description: 'Etiqueta excluída e tirada de contatos e conversas (tela ou API)', since: 'labels', available: true, available_after: null, feature: 'labels',
    label: 'Etiqueta excluída' },
  { event: 'contact.labels_updated',    description: 'Etiquetas do contato mudaram (tela ou API)', since: 'labels', available: true, available_after: null, feature: 'labels',
    label: 'Etiquetas do contato', hint: 'com a origem: tela ou API' },
  { event: 'conversation.labels_updated', description: 'Etiquetas da conversa mudaram (tela, API, celular ou automática)', since: 'labels', available: true, available_after: null, feature: 'labels',
    label: 'Etiquetas da conversa', hint: 'com a origem: tela, API, celular ou automática' },
  { event: 'whatsapp.connection',       description: 'Número conectou ou desconectou', since: 'p1', available: false, available_after: 'P1-W2',
    label: 'WhatsApp conectou/desconectou' },
];
