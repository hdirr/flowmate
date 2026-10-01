// Objeto Mensagem do contrato (20-contrato-api-v1.md), comum às rotas de leitura de mensagens
// (P1-L7 last_message, P1-L8, P1-L9). No banco a coluna do tipo é message_type.
export const MESSAGE_COLS = 'id, message_id, conversation_id, remote_jid, from_me, sender, '
  + 'message_type, content, media_url, file_name, timestamp, status';

export function toMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    message_id: m.message_id,
    conversation_id: m.conversation_id,
    remote_jid: m.remote_jid,
    from_me: !!m.from_me,
    sender: m.sender ?? null,
    type: m.message_type ?? null,
    content: m.content ?? null,
    media_url: m.media_url ?? null,
    file_name: m.file_name ?? null,
    // bigint em segundos; sai como número
    timestamp: m.timestamp === null || m.timestamp === undefined ? null : Number(m.timestamp),
    status: m.status ?? null,
  };
}
