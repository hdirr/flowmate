import { adminClient } from '../db.js';
import { fail } from './http.js';

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

// O message_id do WhatsApp não é UUID: é um id alfanumérico (hoje, hex maiúsculo de 20, 22 ou
// 32 caracteres). Aceita letras, dígitos, _ e -, até 128 caracteres; fora disso → 404 sem ir ao
// banco. A comparação é exata (diferencia maiúsculas), como o WhatsApp gera.
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// GET /v1/messages/{messageId} — uma Mensagem pelo message_id do WhatsApp.
// Só da empresa da chave (company_id): id de outra empresa → 404, nunca a mensagem.
// Se houver mais de uma linha com o mesmo message_id na empresa, devolve a mais recente
// (timestamp desc, id desc) — comportamento registrado no relatório da P1-L9.
export async function getMessage(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'message_not_found', 'Mensagem não encontrada.');
  if (!MESSAGE_ID_RE.test(String(params.id || ''))) return notFound();

  try {
    const { data, error } = await adminClient().from('whatsapp_messages')
      .select(MESSAGE_COLS)
      .eq('company_id', companyId).eq('message_id', params.id)
      .order('timestamp', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data?.length) return notFound();
    return res.status(200).json(toMessage(data[0]));
  } catch (e) {
    console.error('[v1] message falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar a mensagem.');
  }
}
