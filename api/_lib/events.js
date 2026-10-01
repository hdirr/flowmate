// Catálogo oficial dos eventos de webhook de saída. Usado pelo GET /v1/webhook-events
// (P1-L10) e, na P1-W3, pela tela de Integrações (src/pages/Settings.jsx).
export const WEBHOOK_EVENTS = [
  { event: 'message.received',          description: 'Cliente mandou mensagem (só com a conversa em automação)', since: 'v1' },
  { event: 'message.sent',              description: 'O FlowMate enviou uma mensagem', since: 'v1' },
  { event: 'contact.created',           description: 'Contato criado', since: 'v1' },
  { event: 'lead.created',              description: 'Lead criado', since: 'v1' },
  { event: 'lead.moved',                description: 'Lead mudou de etapa ou de funil', since: 'v1' },
  // novos da Parte 1:
  { event: 'contact.updated',           description: 'Contato alterado pela API', since: 'p1' },
  { event: 'contact.tags_updated',      description: 'Tags do contato alteradas pela API', since: 'p1' },
  { event: 'lead.updated',              description: 'Lead alterado pela API', since: 'p1' },
  { event: 'note.created',              description: 'Nota interna criada pela API', since: 'p1' },
  { event: 'conversation.state_changed',description: 'Conversa mudou entre automação e humano', since: 'p1' },
  { event: 'whatsapp.connection',       description: 'Número conectou ou desconectou', since: 'p1' },
];
