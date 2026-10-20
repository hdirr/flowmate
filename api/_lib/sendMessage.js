import { adminClient, instanceNameFor, toWhatsAppNumber } from './db.js';
import { getOrCreateConversation, setConversationState, findTwinConversation, markTwinHuman, STATE } from './conversations.js';
import { dispatchWebhook } from './webhooks.js';
import { isFeatureOn, automationBlockedByHuman } from './features.js';
import { deliver, findByIdempotencyKey, processOutbound, outboundRetryDelaySeconds, MAX_ATTEMPTS as OUT_MAX_ATTEMPTS, AMBIGUOUS_PREFIX } from './outbound.js';

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
export async function sendMessage({ companyId, to, sender, actorUserId = null, content, media = null, idempotencyKey = null }) {
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

  // CF-A · A6: fila de envio (chave send_queue). Repetição com a mesma Idempotency-Key devolve o
  // resultado do primeiro envio, sem enviar de novo (antes até da checagem de pausa).
  const queueOn = await isFeatureOn(companyId, 'send_queue', admin);
  // Fila desligada: o header é ignorado (como antes). Ligada: precisa ser válido.
  if (!queueOn) idempotencyKey = null;
  else if (idempotencyKey !== null && !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey)) {
    return { error: 'invalid_field', message: '"Idempotency-Key": de 1 a 128 caracteres visíveis, sem espaço.', status: 400 };
  }
  if (queueOn && idempotencyKey) {
    const prev = await findByIdempotencyKey(admin, companyId, idempotencyKey).catch(() => null);
    if (prev) return fromOutboundRow(prev, { duplicate: true });
  }

  const conversation = await getOrCreateConversation(companyId, remoteJid);

  // ─── O CORAÇÃO ───
  // A pausa é imposta no ponto de saída, não checada pelo consumidor.
  // Sem isso, o n8n lê "automation", leva 4s no RAG, e dispara por cima do humano
  // que assumiu a conversa nesse meio-tempo. Não teve bug — a flag foi lida antes da pausa existir.
  // (Grupos pulam esta checagem: `isGroup` é false para chamadas de 1:1.)
  // Conversa gêmea (com/sem o 9º dígito, P1-E0): se QUALQUER uma das duas estiver em human,
  // recusa. As duplicadas não são juntadas aqui (Parte 2).
  // ET-3: com a chave labels ligada, a trava só vale com block_api_send_on_human (etiqueta é
  // marcador; quem decide é o n8n). Desligada = como sempre.
  if (!isGroup && sender === STATE.AUTOMATION && await automationBlockedByHuman(companyId, admin)) {
    const paused = await findPausedConversation(admin, companyId, conversation, remoteJid);
    if (paused) return { error: 'conversation_paused', status: 409, conversationId: paused.id };
  }
  // Sem conversa (leitura/criação falhou) não há onde registrar nem como saber o estado:
  // não envia (envio humano e grupo; o automático em 1:1 já parou no 409 acima).
  if (!conversation) return { error: 'conversation_unavailable', status: 503 };

  if (queueOn) {
    return sendQueued(admin, { companyId, instanceName, conversation, remoteJid, number, isGroup, sender, actorUserId, content, media, idempotencyKey });
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

  await finishSent(admin, { companyId, conversation, instanceName, remoteJid, number, isGroup, sender, actorUserId, content, media, messageId });
  return { ok: true, messageId, conversationId: conversation.id };
}

// Depois que a Evolution aceitou: grava no log, faz a transição humano e espelha no webhook.
// (Mesmo código de antes da A6; usado pelo envio direto e pela fila.)
async function finishSent(admin, { companyId, conversation, instanceName, remoteJid, number, isGroup, sender, actorUserId, content, media, messageId }) {
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
  // ET-3: com a chave labels, a gêmea também vira "Atendimento humano".
  if (!isGroup && sender === STATE.HUMAN) await markTwinHuman(companyId, conversation, actorUserId, 'user', admin);

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

}


// ─── CF-A · A6: fila de envio ────────────────────────────────────────────────

// Resultado para quem chamou, a partir da linha da fila.
function fromOutboundRow(row, extra = {}) {
  const base = { outboundId: row.id, delivery: row.status, conversationId: row.conversation_id, ...extra };
  if (row.status === 'sent') return { ok: true, messageId: row.message_id, ...base };
  if (row.status === 'pending' || row.status === 'sending') return { ok: true, queued: true, status: 202, ...base };
  return { error: row.last_error || 'delivery_failed', status: 502, ...base };
}

async function sendQueued(admin, ctx, deliverImpl) {
  const { companyId, instanceName, conversation, remoteJid, sender, actorUserId, content, media, idempotencyKey } = ctx;
  const { data: row, error } = await admin.from('outbound_messages').insert({
    company_id: companyId, instance_name: instanceName, conversation_id: conversation.id,
    remote_jid: remoteJid, sender, actor_user_id: actorUserId, content: content || null, media: media || null,
    idempotency_key: idempotencyKey || null, status: 'sending', attempts: 1,
  }).select('*').single();
  if (error) {
    if (error.code === '23505' && idempotencyKey) {   // corrida com a mesma chave
      const prev = await findByIdempotencyKey(admin, companyId, idempotencyKey).catch(() => null);
      if (prev) return fromOutboundRow(prev, { duplicate: true });
    }
    console.error('[send-queue] não registrou o envio:', error.message);
    return { error: 'queue_unavailable', status: 503 };   // nada foi enviado
  }
  return attemptDelivery(admin, row, ctx, deliverImpl);
}

// Uma tentativa de entrega da linha (já marcada 'sending'). deliverImpl injetável (teste).
async function attemptDelivery(admin, row, ctx, deliverImpl = deliver) {
  const r = await deliverImpl({
    evolutionUrl: EVOLUTION_URL, evolutionKey: EVOLUTION_KEY, instanceName: ctx.instanceName,
    number: ctx.number, content: ctx.content, media: ctx.media,
    ...(ctx.timeoutMs ? { timeoutMs: ctx.timeoutMs } : {}),
  });
  if (r.kind === 'sent') {
    await admin.from('outbound_messages').update({ status: 'sent', message_id: r.messageId, sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
    await finishSent(admin, { ...ctx, messageId: r.messageId });
    return { ok: true, messageId: r.messageId, conversationId: ctx.conversation.id, outboundId: row.id, delivery: 'sent', kind: 'sent' };
  }
  if (r.kind === 'retry') {
    const dead = row.attempts >= OUT_MAX_ATTEMPTS;
    await admin.from('outbound_messages').update({
      status: dead ? 'dead' : 'pending', last_error: r.error,
      next_attempt_at: new Date(Date.now() + outboundRetryDelaySeconds(row.attempts) * 1000).toISOString(),
    }).eq('id', row.id);
    if (dead) return { error: r.error, status: 502, conversationId: ctx.conversation.id, outboundId: row.id, delivery: 'dead', kind: 'retry' };
    return { ok: true, queued: true, status: 202, conversationId: ctx.conversation.id, outboundId: row.id, delivery: 'pending', kind: 'retry' };
  }
  await admin.from('outbound_messages').update({ status: 'failed', last_error: (r.ambiguous ? AMBIGUOUS_PREFIX : '') + r.error }).eq('id', row.id);
  return { error: r.error, status: 502, conversationId: ctx.conversation.id, outboundId: row.id, delivery: 'failed', kind: 'failed' };
}

// Processador (/jobs): reenvia os pendentes, conferindo a pausa de novo.
export async function retryOutbound(admin, { deadline, deliverImpl } = {}) {
  const loadConv = async (row) => {
    const { data } = await admin.from('conversations').select('*')
      .eq('company_id', row.company_id).eq('id', row.conversation_id).maybeSingle();
    return data || null;
  };
  return processOutbound(admin, {
    deadline,
    checkPaused: async (row) => {
      if (String(row.remote_jid).includes('@g.us')) return false;
      // ET-3: com labels ligada e sem a trava opcional, envio automático não para por humano.
      if (row.sender === STATE.AUTOMATION && !(await automationBlockedByHuman(row.company_id, admin))) return false;
      return !!(await findPausedConversation(admin, row.company_id, await loadConv(row), row.remote_jid));
    },
    send: async (row) => {
      const isGroup = String(row.remote_jid).includes('@g.us');
      const conv = await loadConv(row);
      if (!conv) {
        await admin.from('outbound_messages').update({ status: 'failed', last_error: 'conversa não encontrada' }).eq('id', row.id);
        return { kind: 'failed' };
      }
      const attempts = row.attempts + 1;
      await admin.from('outbound_messages').update({ attempts, next_attempt_at: new Date().toISOString() }).eq('id', row.id);
      // O JID da conversa já é o número internacional: vai com "+" (sem renormalizar).
      const number = isGroup ? row.remote_jid : row.remote_jid.replace(/@.*/, '');
      return attemptDelivery(admin, { ...row, attempts }, {
        companyId: row.company_id, instanceName: row.instance_name, conversation: conv, remoteJid: row.remote_jid,
        number, isGroup, sender: row.sender, actorUserId: row.actor_user_id, content: row.content, media: row.media,
        timeoutMs: 5_000,   // o processador tem prazo curto
      }, deliverImpl);
    },
  });
}

// Só para teste.
export const _test = { attemptDelivery, fromOutboundRow, sendQueued };
