export const TRIGGER_TYPES = [
  { value: 'contact_created',     label: 'Contato criado' },
  { value: 'contact_moved_stage', label: 'Contato movido de etapa' },
  { value: 'tag_added',           label: 'Tag adicionada' },
  { value: 'webhook_received',    label: 'Webhook recebido' },
];

export const ACTION_TYPES = [
  { value: 'email',      label: 'Enviar e-mail' },
  { value: 'whatsapp',   label: 'Enviar WhatsApp' },
  { value: 'move_stage', label: 'Mover de etapa' },
  { value: 'add_tag',    label: 'Adicionar tag' },
  { value: 'delay',      label: 'Aguardar' },
  { value: 'webhook',    label: 'Chamar Webhook' },
];
