import { adminClient, instanceNameFor, toWhatsAppNumber, jidFor } from './db.js';
import { getOrCreateConversation, setConversationState, STATE } from './conversations.js';
import { dispatchWebhook } from './webhooks.js';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

/**
 * Serviço único de envio. UI (JWT) e n8n (API key) chamam esta mesma função.
 * Auth diferente, regra idêntica. É AQUI o ponto de enforcement.
 *
 * @param {string}  companyId
 * @param {string}  to           número do destinatário
 * @param {string}  sender       'automation' | 'human'
 * @param {string}  actorUserId  usuário que enviou (só quando sender = 'human')
 * @param {string}  content      texto (ou legenda, se for mídia)
 * @param {object}  media        { url, type, mimeType, fileName } — opcional
 *
 * @returns {{ ok: true, messageId, conversationId }}
 *        | {{ error: 'conversation_paused', status: 409 }}
 *        | {{ error: string, status: number }}
 */
export async function sendMessage({ companyId, to, sender, actorUserId = null, content, media = null }) {
  if (!companyId || !to || (!content && !media)) {
    return { error: 'invalid_request', status: 400 };
  }
  if (sender !== STATE.AUTOMATION && sender !== STATE.HUMAN) {
    return { error: 'invalid_sender', status: 400 };
  }

  const admin = adminClient();
  const number = toWhatsAppNumber(to);
  const remoteJid = jidFor(number);
  const instanceName = instanceNameFor(companyId);

  const conversation = await getOrCreateConversation(companyId, remoteJid);

  // ─── O CORAÇÃO ───
  // A pausa é imposta no ponto de saída, não checada pelo consumidor.
  // Sem isso, o n8n lê "automation", leva 4s no RAG, e dispara por cima do humano
  // que assumiu a conversa nesse meio-tempo. Não teve bug — a flag foi lida antes da pausa existir.
  if (sender === STATE.AUTOMATION && conversation.state === STATE.HUMAN) {
    return { error: 'conversation_paused', status: 409, conversationId: conversation.id };
  }

  // ─── Entrega via Evolution ───
  let evoRes;
  if (media) {
    evoRes = await fetch(`${EVOLUTION_URL}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({
        number,
        mediatype: media.type,
        mimetype: media.mimeType || undefined,
        media: media.url,
        fileName: media.fileName || undefined,
        caption: content || undefined,
      }),
    });
  } else {
    evoRes = await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ number, text: content }),
    });
  }

  if (!evoRes.ok) {
    const err = await evoRes.json().catch(() => ({}));
    return { error: err.message || 'delivery_failed', status: 502 };
  }

  // Guarda o message_id devolvido pela Evolution. É isso que permite, no webhook,
  // distinguir "fui eu que mandei" de "o dono mandou pelo celular".
  const evoData = await evoRes.json().catch(() => ({}));
  const messageId = evoData?.key?.id || null;

  // ─── Grava no log ───
  await admin.from('whatsapp_messages').insert({
    company_id: companyId,
    conversation_id: conversation.id,
    instance_name: instanceName,
    remote_jid: remoteJid,
    from_me: true,
    message_type: media ? media.type : 'text',
    content: content || (media?.type === 'image' ? '[imagem]' : media?.type === 'video' ? '[vídeo]' : '[documento]'),
    media_url: media?.url || null,
    file_name: media?.fileName || null,
    timestamp: Math.floor(Date.now() / 1000),
    status: 'sent',
    message_id: messageId,
    sender,
  });

  // ─── Transição: humano digitou → conversa vira human ───
  // Automático. Não obriga a clicar num botão antes — ele vai esquecer,
  // e a automação vai atropelar.
  if (sender === STATE.HUMAN && conversation.state !== STATE.HUMAN) {
    await setConversationState(conversation.id, STATE.HUMAN, actorUserId);
  }

  // ─── Espelha no webhook do tenant ───
  // Vai o campo `sender` junto: o consumidor filtra o que é dele.
  // (Se o n8n é quem envia, ele pode desmarcar message.sent e evitar o eco.)
  await dispatchWebhook(companyId, 'message.sent', {
    conversation_id: conversation.id,
    contact_id: conversation.contact_id,
    remote_jid: remoteJid,
    to: number,
    content: content || null,
    media_url: media?.url || null,
    message_id: messageId,
    sender,
    timestamp: Math.floor(Date.now() / 1000),
  });

  return { ok: true, messageId, conversationId: conversation.id };
}
