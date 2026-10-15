// CF-A · A6 — Fila de envio (chave `send_queue` por empresa; desligada = sendMessage como hoje).
//
// Grava o envio em outbound_messages ANTES de chamar a Evolution e acompanha o status:
//   sending → sent | pending (vai tentar de novo) | failed (não tenta de novo) | dead
// Regra de ouro: NUNCA reenviar o que pode ter saído. Só volta para a fila o erro em que há
// certeza de que a Evolution não recebeu o pedido:
//   - erro de rede ANTES de conectar (NOT_SENT_CODES: conexão recusada, DNS, tempo de conexão);
//     conexão caída no meio é ambígua (failed);
//   - 404 "Application not found" da borda do Railway (serviço fora).
// Tempo esgotado e 5xx são AMBÍGUOS (pode ter saído): 'failed', sem reenvio. Se tiver saído, o
// eco do WhatsApp chega pelo webhook e casa com a linha (matchEcho), que vira 'sent'.
// Reenvio (processador /jobs): confere a pausa de novo e não envia mensagem com mais de
// MAX_AGE_MS (vira 'dead': resposta automática atrasada é pior que nenhuma).

export const SEND_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPTS = 5;
export const MAX_AGE_MS = 10 * 60_000;
export const ECHO_WINDOW_MS = 2 * 60_000;
// Erros de rede em que o pedido certamente não saiu (falhou antes de conectar).
export const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
// Prefixo do last_error dos 'failed' AMBÍGUOS (podem ter saído): só esses casam com o eco por texto.
export const AMBIGUOUS_PREFIX = '[ambíguo] ';

export function outboundRetryDelaySeconds(attempts) {
  return Math.min(15 * 2 ** Math.max(0, attempts - 1), 120); // 15 s, 30 s, 60 s, 120 s
}

// Objeto de status para a API/tela.
export function toOutbound(r) {
  return {
    id: r.id, status: r.status, attempts: r.attempts, last_error: r.last_error,
    message_id: r.message_id, conversation_id: r.conversation_id, remote_jid: r.remote_jid,
    sender: r.sender, created_at: r.created_at, sent_at: r.sent_at,
  };
}

// Chama a Evolution e classifica o resultado. fetchImpl injetável (teste).
// → { kind: 'sent', messageId } | { kind: 'retry', error } | { kind: 'failed', error, httpStatus }
export async function deliver({ evolutionUrl, evolutionKey, instanceName, number, content, media, fetchImpl = fetch, timeoutMs = SEND_TIMEOUT_MS }) {
  const path = media ? 'sendMedia' : 'sendText';
  const body = media
    ? { number, mediatype: media.type, mimetype: media.mimeType || undefined, media: media.url, fileName: media.fileName || undefined, caption: content || undefined }
    : { number, text: content };
  let res;
  try {
    res = await fetchImpl(`${evolutionUrl}/message/${path}/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': evolutionKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e?.name || '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'failed', error: 'timeout: a Evolution não respondeu (pode ter enviado)', ambiguous: true };
    }
    // Só volta para a fila erro em que o pedido certamente NÃO chegou (antes de conectar).
    // Conexão caída no meio (ECONNRESET, "other side closed"…) é ambígua: pode ter saído.
    const code = e?.cause?.code || e?.code || '';
    if (NOT_SENT_CODES.has(code)) return { kind: 'retry', error: `rede: ${code}` };
    return { kind: 'failed', error: `rede: ${code || e?.message || 'falha'} (pode ter enviado)`, ambiguous: true };
  }
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return { kind: 'sent', messageId: data?.key?.id || null };
  }
  const text = await res.text().catch(() => '');
  if (res.status === 404 && /application not found/i.test(text)) {
    return { kind: 'retry', error: 'Evolution fora (borda do Railway: Application not found)' };
  }
  let msg = '';
  try { msg = JSON.parse(text)?.message; } catch { /* corpo não-JSON */ }
  // 5xx: a Evolution pode ter enviado antes de falhar → ambíguo. 4xx: recusado.
  return { kind: 'failed', error: (Array.isArray(msg) ? msg.join('; ') : msg) || `delivery_failed (${res.status})`, httpStatus: res.status, ambiguous: res.status >= 500 };
}

// Procura um envio já registrado com a mesma chave de idempotência.
export async function findByIdempotencyKey(db, companyId, key) {
  if (!key) return null;
  const { data, error } = await db.from('outbound_messages').select('*')
    .eq('company_id', companyId).eq('idempotency_key', key).maybeSingle();
  if (error) throw new Error(`outbound_messages: ${error.message}`);
  return data || null;
}

// O eco de um envio do FlowMate chegou pelo webhook (fromMe)? Casa por message_id, ou (sem
// message_id ainda: corrida do eco, tempo esgotado) por número + texto nos últimos 2 min.
// Casou → marca 'sent' com o message_id. Erro de leitura → null (quem chama decide).
export async function matchEcho(db, { companyId, remoteJid, messageId, content, now = Date.now() }) {
  try {
    if (messageId) {
      const { data, error } = await db.from('outbound_messages').select('id')
        .eq('company_id', companyId).eq('message_id', messageId).limit(1);
      if (error) return null;
      if (data?.length) return { matched: true, id: data[0].id };
    }
    if (!remoteJid || !content) return { matched: false };
    // Só pode ser eco do FlowMate o que PODE ter saído: 'sending' ou 'failed' ambíguo. 'pending'
    // (certeza de que não saiu) e 'failed' recusado nunca casam — senão uma resposta real do dono
    // pelo celular com o mesmo texto deixaria de pausar a conversa.
    // Janela pelo início da ÚLTIMA tentativa (next_attempt_at é atualizado ao reenviar).
    const since = new Date(now - ECHO_WINDOW_MS).toISOString();
    const { data: cand, error: cErr } = await db.from('outbound_messages').select('id, status, content, last_error')
      .eq('company_id', companyId).eq('remote_jid', remoteJid).gte('next_attempt_at', since)
      .in('status', ['sending', 'failed']).is('message_id', null)
      .order('created_at', { ascending: false }).limit(5);
    if (cErr) return null;
    const hit = (cand || []).find(c => c.content === content
      && (c.status === 'sending' || String(c.last_error || '').startsWith(AMBIGUOUS_PREFIX)));
    if (!hit) return { matched: false };
    await db.from('outbound_messages').update({ status: 'sent', message_id: messageId || null, sent_at: new Date(now).toISOString(), last_error: null })
      .eq('id', hit.id);
    return { matched: true, id: hit.id };
  } catch { return null; }
}

// Reserva uma linha pendente para reenviar (só um processador pega).
async function claim(db, id) {
  const { data, error } = await db.from('outbound_messages')
    .update({ status: 'sending' }).eq('id', id).eq('status', 'pending').select('*');
  if (error) return null;
  return data?.[0] || null;
}

// Processador (A6): reenvia os 'pending' vencidos. send(row) faz a entrega e o registro
// (injetado pelo sendMessage, para reaproveitar o mesmo caminho do envio na hora).
// checkPaused(row) → true se a conversa estiver pausada agora (não reenvia automação).
export const STUCK_MS = 2 * 60_000;

export async function processOutbound(db, { send, checkPaused, now = Date.now(), deadline = now + 3_000, limit = 20 } = {}) {
  // Linha presa em 'sending' (a função foi interrompida no meio): pode ter saído → 'failed',
  // sem reenvio. Se tiver saído, o eco casa e ela vira 'sent'.
  const stuck = new Date(now - STUCK_MS).toISOString();
  await db.from('outbound_messages').update({ status: 'failed', last_error: AMBIGUOUS_PREFIX + 'interrompido durante o envio (pode ter sido enviada)' })
    .eq('status', 'sending').lt('created_at', stuck).lt('next_attempt_at', stuck);
  const { data: due, error } = await db.from('outbound_messages').select('id')
    .eq('status', 'pending').lte('next_attempt_at', new Date(now).toISOString())
    .order('created_at', { ascending: true }).limit(limit);
  if (error) return { error: error.message };
  const out = { sent: 0, retry: 0, failed: 0, dead: 0, paused: 0 };
  for (const { id } of due || []) {
    if (Date.now() > deadline) break;
    const row = await claim(db, id);
    if (!row) continue;
    const age = now - new Date(row.created_at).getTime();
    if (age > MAX_AGE_MS) {
      await db.from('outbound_messages').update({ status: 'dead', last_error: 'expirada: não reenviada depois de 10 min' }).eq('id', row.id);
      out.dead++; continue;
    }
    if (row.sender === 'automation' && await checkPaused(row)) {
      await db.from('outbound_messages').update({ status: 'failed', last_error: 'conversation_paused (pausada antes do reenvio)' }).eq('id', row.id);
      out.paused++; continue;
    }
    const r = await send(row);
    out[r.kind === 'sent' ? 'sent' : r.kind === 'retry' ? (row.attempts + 1 >= MAX_ATTEMPTS ? 'dead' : 'retry') : 'failed']++;
  }
  return out;
}
