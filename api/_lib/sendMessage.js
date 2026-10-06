import { adminClient, instanceNameFor, toWhatsAppNumber } from './db.js';
import { getOrCreateConversation, setConversationState, findTwinConversation, STATE } from './conversations.js';
import { dispatchWebhook } from './webhooks.js';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

// Devolve a conversa que bloqueia o envio automático: a própria ou a gêmea (mesmo celular BR
// com/sem o 9º dígito). null = pode enviar. Exportada para teste.
// Na dúvida, bloqueia (P1-E0b): conversa nula (leitura/criação falhou), estado que não é
// exatamente 'automation' (leitura incompleta) ou erro ao ler a gêmea → 409.
export async function findPausedConversation(admin, companyId, conversation, remoteJid) {
  if (!conversation) return { id: null, state: STATE.HUMAN };
  if (conversation.state !== STATE.AUTOMATION) return conversation;
  const { twin, error } = await findTwinConversation(companyId, remoteJid, admin);
  if (error) return { id: conversation.id ?? null, state: STATE.HUMAN };
  return twin && twin.state !== STATE.AUTOMATION ? twin : null;
}

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

  // ─── Grupo ou 1:1? ───
  // JID de grupo (termine em @g.us) NÃO passa por toWhatsAppNumber/jidFor —
  // a normalização quebraria os dígitos do grupo. Grupos também IGNORAM a pausa
  // automático/humano (decisão de produto): o enforcement (409) vale só em 1:1.
  const isGroup = String(to || '').includes('@g.us');
  const number = isGroup ? String(to).trim() : toWhatsAppNumber(to);
  // JID direto do número já normalizado (normalizar duas vezes mudaria "+7 9xx…" para 55…).
  const remoteJid = isGroup ? number : `${number}@s.whatsapp.net`;
  const instanceName = instanceNameFor(companyId);

  const conversation = await getOrCreateConversation(companyId, remoteJid);

  // ─── O CORAÇÃO ───
  // A pausa é imposta no ponto de saída, não checada pelo consumidor.
  // Sem isso, o n8n lê "automation", leva 4s no RAG, e dispara por cima do humano
  // que assumiu a conversa nesse meio-tempo. Não teve bug — a flag foi lida antes da pausa existir.
  // (Grupos pulam esta checagem: `isGroup` é false para chamadas de 1:1.)
  // Conversa gêmea (com/sem o 9º dígito, P1-E0): se QUALQUER uma das duas estiver em human,
  // recusa. As duplicadas não são juntadas aqui (Parte 2).
  if (!isGroup && sender === STATE.AUTOMATION) {
    const paused = await findPausedConversation(admin, companyId, conversation, remoteJid);
    if (paused) return { error: 'conversation_paused', status: 409, conversationId: paused.id };
  }
  // Sem conversa (leitura/criação falhou) não há onde registrar nem como saber o estado:
  // não envia (envio humano e grupo; o automático em 1:1 já parou no 409 acima).
  if (!conversation) return { error: 'conversation_unavailable', status: 503 };

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
    participant_jid: null,
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
  // e a automação vai atropelar. (Grupos ficam sempre em automation de exibição;
  // a pausa não existe para eles.)
  if (!isGroup && sender === STATE.HUMAN && conversation.state !== STATE.HUMAN) {
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
