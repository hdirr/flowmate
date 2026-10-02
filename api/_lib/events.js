// Catálogo oficial dos eventos de webhook de saída. Usado pelo GET /v1/webhook-events
// (P1-L10) e, na P1-W3, pela tela de Integrações (src/pages/Settings.jsx).
//
// available: o evento já é emitido hoje? available_after: a etapa do roteiro de que ele
// depende (null quando já sai). Atualize os dois na tarefa que passar a emitir o evento —
// assim o cliente não assina, sem saber, um evento que ainda nunca chega.
export const WEBHOOK_EVENTS = [
  { event: 'message.received',          description: 'Cliente mandou mensagem (só com a conversa em automação)', since: 'v1', available: true,  available_after: null },
  { event: 'message.sent',              description: 'O FlowMate enviou uma mensagem', since: 'v1', available: true,  available_after: null },
  { event: 'contact.created',           description: 'Contato criado', since: 'v1', available: true,  available_after: null },
  { event: 'lead.created',              description: 'Lead criado', since: 'v1', available: true,  available_after: null },
  { event: 'lead.moved',                description: 'Lead mudou de etapa ou de funil', since: 'v1', available: true,  available_after: null },
  // novos da Parte 1 (ainda não emitidos):
  { event: 'contact.updated',           description: 'Contato alterado pela API', since: 'p1', available: false, available_after: 'P1-E2' },
  { event: 'contact.tags_updated',      description: 'Tags do contato alteradas pela API', since: 'p1', available: true,  available_after: null },
  { event: 'lead.updated',              description: 'Lead alterado pela API', since: 'p1', available: true,  available_after: null },
  { event: 'note.created',              description: 'Nota interna criada pela API', since: 'p1', available: true,  available_after: null },
  { event: 'conversation.state_changed',description: 'Conversa mudou entre automação e humano', since: 'p1', available: true,  available_after: null },
  { event: 'whatsapp.connection',       description: 'Número conectou ou desconectou', since: 'p1', available: false, available_after: 'P1-W2' },
];
