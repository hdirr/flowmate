// Catálogo oficial dos eventos de webhook de saída — FONTE ÚNICA. Usado pelo
// GET /v1/webhook-events (P1-L10) e pela tela de Integrações (src/pages/Settings.jsx, P1-W3),
// que mostra só os eventos com available: true. Este arquivo é importado também pelo front:
// mantenha-o sem dependências de Node.
//
// available: o evento já é emitido hoje? available_after: a etapa do roteiro de que ele
// depende (null quando já sai). Atualize os dois na tarefa que passar a emitir o evento —
// assim o cliente não assina, sem saber, um evento que ainda nunca chega.
// label/hint: texto curto da tela (a API devolve description).
export const WEBHOOK_EVENTS = [
  { event: 'message.received',          description: 'Cliente mandou mensagem (só com a conversa em automação)', since: 'v1', available: true,  available_after: null,
    label: 'Mensagem recebida', hint: 'só quando a conversa está em automação' },
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
  { event: 'whatsapp.connection',       description: 'Número conectou ou desconectou', since: 'p1', available: false, available_after: 'P1-W2',
    label: 'WhatsApp conectou/desconectou' },
];
