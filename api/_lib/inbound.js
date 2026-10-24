import { getOrCreateConversation, setConversationState, isKnownOutgoing, markTwinHuman, STATE } from './conversations.js';
import { dispatchWebhook } from './webhooks.js';
import { isFeatureOn } from './features.js';
import { labelsOfConversations } from './labels.js';
import { parseMessage } from './whatsappParse.js';
import { matchEcho } from './outbound.js';
import { debug } from './log.js';

// Recebimento de mensagens da Evolution (webhook). Dois caminhos:
//
// - LEGADO (chave inbound_inbox desligada): handleIncomingMessageLegacy — é o corpo do laço
//   que estava em handleWebhook, movido sem mudança de lógica.
// - CAIXA DE ENTRADA DURÁVEL (CF-A, A1/A2/A3; chave inbound_inbox ligada):
//   1. acceptWebhook grava cada evento cru em inbound_events ANTES de processar;
//      se não conseguir gravar → 503 (a Evolution reenvia). Só responde 2xx depois de gravar.
//   2. processa em seguida (processEvent); falha → 'failed' com nova tentativa agendada
//      (espera crescente) e, depois de MAX_ATTEMPTS, 'dead' (fila de mortos). Nunca descarta.
//   3. o processador (rota /api/whatsapp/jobs, chamada pelo pg_cron) reprocessa os pendentes.
//   O processamento é idempotente: mensagem já gravada (23505) conta como sucesso; o
//   message.received sai com event_id = id do evento de entrada (o n8n deduplica nas
//   repetições); "já gravada" não pula a pausa nem o evento (o evento só termina 'done').

export const MAX_ATTEMPTS = 8;

// Espera antes da próxima tentativa: 30 s, 1, 2, 4, 8, 16, 32 min … até 1 h.
export function retryDelaySeconds(attempts) {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);
}

// ─── conexão (igual nos dois caminhos) ───────────────────────────────────────
export async function applyConnectionUpdate(db, { companyId, instanceName, body }) {
  const state = body?.data?.state;
  const phone = body?.data?.wuid?.replace('@s.whatsapp.net', '') || null;
  if (!companyId) return;
  const { error } = await db.from('whatsapp_instances').upsert({
    company_id: companyId,
    instance_name: instanceName,
    status: state === 'open' ? 'connected' : 'disconnected',
    phone,
  }, { onConflict: 'company_id' });
  return { error };
}

// ─── LEGADO (sem mudança de lógica; antes ficava dentro de handleWebhook) ─────
export async function handleIncomingMessageLegacy(db, { companyId, instanceName, msg }) {
  const key = msg.key || {};
  const remoteJid = key.remoteJidAlt || key.remoteJid || msg.remoteJid || '';
  if (!remoteJid) return;

  const isGroup = remoteJid.includes('@g.us');
  const participantJid = isGroup ? (key.participant || msg.participant || null) : null;

  const fromMe = key.fromMe ?? msg.fromMe ?? false;
  const messageId = key.id || msg.id;

  // Dedup: se já gravamos essa mensagem NESTA empresa, ignora (CF-A A2: por empresa).
  const { data: dup } = await db
    .from('whatsapp_messages').select('id').eq('company_id', companyId).eq('message_id', messageId).limit(1);
  const alreadyLogged = !!(dup && dup.length);

  const parsed = parseMessage(msg.message);
  const content = parsed.content || msg.text || '[mídia]';
  debug(`[webhook] msg jid=${remoteJid} id=${messageId} type=${parsed.type} fromMe=${fromMe} dup=${alreadyLogged}`);

  const contactName = isGroup
    ? (msg.pushName || (participantJid ? participantJid.replace(/@.*/, '') : remoteJid.replace(/@.*/, '')))
    : (msg.pushName || remoteJid.replace(/@.*/, ''));

  const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

  // 1) Cria ou recupera a conversa (default: automation). null = leitura falhou (P1-E0b):
  //    a mensagem é gravada mesmo assim, sem mexer no estado e sem repassar message.received.
  //    Grupos também ganham linha (conversation_id no log), mas a máquina
  //    de estado automático|humano NÃO se aplica a eles.
  const conversation = await getOrCreateConversation(companyId, remoteJid, db);

  // 2) 1:1 — fromMe com message_id DESCONHECIDO = o dono respondeu pelo celular.
  //    Esse é o caso que fura a feature se for esquecido: a recepcionista responde
  //    pelo WhatsApp do celular (é o que ela sempre fez) e a automação atropela.
  //    Em GRUPOS isso é ignorado (decisão de produto: grupos não pausam).
  if (!isGroup && fromMe && !alreadyLogged) {
    // CF-A · A6: também é envio do FlowMate se casar com a fila de envio (mesmo message_id, ou
    // eco que chegou antes de o envio ser gravado). Sem fila (chave desligada) não há linhas lá.
    const known = await isKnownOutgoing(messageId, companyId, db)
      || !!(await matchEcho(db, { companyId, remoteJid, messageId, content }))?.matched;
    if (!known && !conversation) {
      console.error(`[webhook] resposta pelo celular sem conversa legível (jid=${remoteJid}); pausa não gravada`);
    } else if (!known && conversation.state !== STATE.HUMAN) {
      await setConversationState(conversation.id, STATE.HUMAN, null, null, db); // null = veio do celular
      conversation.state = STATE.HUMAN;
    }
    if (!known && conversation) await markTwinHuman(companyId, conversation, null, 'phone', db); // ET-3 (só com labels)
  }

  // 3) Grava no log (fonte da verdade)
  if (!alreadyLogged) {
    const { error: insErr } = await db.from('whatsapp_messages').insert({
      company_id: companyId,
      conversation_id: conversation?.id ?? null,
      instance_name: instanceName,
      remote_jid: remoteJid,
      participant_jid: participantJid,
      from_me: fromMe,
      message_type: parsed.type,
      content,
      file_name: parsed.fileName,
      timestamp,
      contact_name: contactName,
      status: fromMe ? 'sent' : 'received',
      message_id: messageId,
    });
    if (insErr) {
      console.error(`[webhook] insert falhou (type=${parsed.type}, id=${messageId}): ${insErr.message}`);
    }
  }

  // 4) Repassa pro consumidor SÓ quando a conversa está em automação e é 1:1.
  //    Em 'human', a automação não precisa nem saber que a mensagem existiu.
  //    Em grupos não repassamos (o robô só ENVIA para grupos).
  //    ET-3: com a chave labels ligada sai SEMPRE (também em "Atendimento humano"), com labels e
  //    state — quem decide se responde é o n8n.
  const labelsOn = !isGroup && !fromMe && !alreadyLogged && conversation ? await isFeatureOn(companyId, 'labels', db) : false;
  if (!isGroup && !fromMe && !alreadyLogged && conversation && (labelsOn || conversation.state === STATE.AUTOMATION)) {
    let extra = {};
    if (labelsOn) {
      let labels = null; // leitura falhou → null (o n8n trata como "não sei")
      try { labels = (await labelsOfConversations(db, companyId, [conversation.id])).get(conversation.id) || []; }
      catch (e) { console.error('[webhook] etiquetas da conversa não lidas:', e?.message || e); }
      extra = { state: conversation.state, labels };
    }
    await dispatchWebhook(companyId, 'message.received', {
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      remote_jid: remoteJid,
      from: remoteJid.replace(/@.*/, ''),
      contact_name: contactName,
      content,
      message_id: messageId,
      timestamp,
      ...extra,
    });
  }
}

// ─── CAIXA DE ENTRADA DURÁVEL ────────────────────────────────────────────────

// Mensagem enviada PELO FLOWMATE (sendMessage grava com sender). As que o webhook, o sync ou
// a reconciliação gravam ficam com sender nulo — por isso a releitura de uma resposta pelo
// celular já gravada não a confunde com envio do FlowMate. Filtrada por empresa (A2).
export async function isFlowmateOutgoing(db, companyId, messageId) {
  if (!messageId) return false;
  const { data, error } = await db.from('whatsapp_messages').select('id')
    .eq('company_id', companyId).eq('message_id', messageId).not('sender', 'is', null).limit(1);
  if (error) throw new Error(`leitura de envio conhecido falhou: ${error.message}`);
  return !!(data && data.length);
}

// R5: a conversa foi devolvida para automação DEPOIS desta mensagem? Só vale para troca de
// estado explícita (state_since mais de 5 s depois da criação da conversa): conversa recém-
// criada (o dono puxou conversa pelo celular) sempre pausa. Timestamp inválido → pausa.
export function resumedAfter(conversation, timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const since = conversation?.state_since ? new Date(conversation.state_since).getTime() : NaN;
  const created = conversation?.created_at ? new Date(conversation.created_at).getTime() : NaN;
  if (!Number.isFinite(since) || !Number.isFinite(created) || since - created <= 5_000) return false;
  return ts * 1000 < since;
}

// Processa UMA mensagem do messages.upsert. Lança erro para nova tentativa (nada se perde: o
// payload cru está em inbound_events). Ordem e efeitos idempotentes.
// dispatch é injetável só para teste.
export async function processIncomingMessage(db, { companyId, instanceName, msg, eventId, dispatch = dispatchWebhook }) {
  const key = msg.key || {};
  const remoteJid = key.remoteJidAlt || key.remoteJid || msg.remoteJid || '';
  if (!remoteJid) return { ignored: 'sem_jid' };

  const isGroup = remoteJid.includes('@g.us');
  const participantJid = isGroup ? (key.participant || msg.participant || null) : null;
  const fromMe = key.fromMe ?? msg.fromMe ?? false;
  const messageId = key.id || msg.id || null;
  const parsed = parseMessage(msg.message);
  const content = parsed.content || msg.text || '[mídia]';
  const contactName = isGroup
    ? (msg.pushName || (participantJid ? participantJid.replace(/@.*/, '') : remoteJid.replace(/@.*/, '')))
    : (msg.pushName || remoteJid.replace(/@.*/, ''));
  const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

  // 1) Conversa. Sem ela não dá para saber o estado: tenta de novo depois.
  const conversation = await getOrCreateConversation(companyId, remoteJid, db);
  if (!conversation) throw new Error('conversation_unavailable');

  // 2) Resposta pelo celular → humano (só 1:1). Repetir é inofensivo (já humano = nada muda).
  //    Reprocessada tarde (ex.: 30 min depois) NÃO desfaz um "devolver para automação" feito
  //    depois da mensagem: só pausa se a mensagem for mais nova que a última troca de estado.
  if (!isGroup && fromMe) {
    const known = await isFlowmateOutgoing(db, companyId, messageId)
      || !!(await matchEcho(db, { companyId, remoteJid, messageId, content }))?.matched;  // A6
    if (!known && conversation.state !== STATE.HUMAN && !resumedAfter(conversation, timestamp)) {
      const r = await setConversationState(conversation.id, STATE.HUMAN, null, null, db);
      if (r?.error) throw new Error(`pausa não gravada: ${r.error.message}`);
      conversation.state = STATE.HUMAN;
    }
    // ET-3 (só com labels): a gêmea também. Mesma regra do R5 (não desfaz um "devolver" posterior).
    if (!known && !resumedAfter(conversation, timestamp)) await markTwinHuman(companyId, conversation, null, 'phone', db);
  }

  // 3) Grava. Já existe (23505: reenvio, sync ou reconciliação) = sucesso.
  const { error: insErr } = await db.from('whatsapp_messages').insert({
    company_id: companyId,
    conversation_id: conversation.id,
    instance_name: instanceName,
    remote_jid: remoteJid,
    participant_jid: participantJid,
    from_me: fromMe,
    message_type: parsed.type,
    content,
    file_name: parsed.fileName,
    timestamp,
    contact_name: contactName,
    status: fromMe ? 'sent' : 'received',
    message_id: messageId,
  });
  if (insErr && insErr.code !== '23505') throw new Error(`insert falhou: ${insErr.message}`);
  if (insErr) {
    // 23505 só é "já gravada" se a linha for DESTA empresa. Se for de outra (índice único
    // global em message_id, que talvez exista hoje), a mensagem não está gravada aqui: tenta
    // de novo (o evento fica guardado) em vez de dar como sucesso.
    const { data: mine, error: chkErr } = await db.from('whatsapp_messages').select('id')
      .eq('company_id', companyId).eq('message_id', messageId).limit(1);
    if (chkErr) throw new Error(`conferência do 23505 falhou: ${chkErr.message}`);
    if (!mine?.length) throw new Error('message_id_ocupado_por_outra_empresa');
  }

  // 4) message.received (regra de hoje: 1:1, não fromMe, conversa em automation), com
  //    event_id fixo = id do evento de entrada.
  //    ET-3: com a chave labels ligada sai SEMPRE, com labels e state (leitura das etiquetas
  //    falhou → tenta de novo; o evento fica guardado).
  const labelsOn = !isGroup && !fromMe ? await isFeatureOn(companyId, 'labels', db) : false;
  if (!isGroup && !fromMe && (labelsOn || conversation.state === STATE.AUTOMATION)) {
    let extra = {};
    if (labelsOn) {
      let labels;
      try { labels = (await labelsOfConversations(db, companyId, [conversation.id])).get(conversation.id) || []; }
      catch (e) { throw new Error(`etiquetas da conversa não lidas: ${e?.message || e}`); }
      extra = { state: conversation.state, labels };
    }
    await dispatch(companyId, 'message.received', {
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      remote_jid: remoteJid,
      from: remoteJid.replace(/@.*/, ''),
      contact_name: contactName,
      content,
      message_id: messageId,
      timestamp,
      ...extra,
    }, { eventId });
  }
  return { ok: true, duplicate: insErr?.code === '23505' };
}

// Linhas de inbound_events para um POST da Evolution (messages.upsert com N mensagens → N).
export function buildInboundRows({ companyId, instanceName, event, body }) {
  if (event === 'messages.upsert') {
    const data = body?.data;
    const list = Array.isArray(data) ? data : data ? [data] : [];
    return list.map(msg => {
      const key = msg?.key || {};
      return {
        company_id: companyId,
        instance_name: instanceName,
        event,
        message_id: key.id || msg?.id || null,
        remote_jid: key.remoteJidAlt || key.remoteJid || msg?.remoteJid || null,
        payload: msg,
      };
    });
  }
  return [{ company_id: companyId, instance_name: instanceName, event, message_id: null, remote_jid: null, payload: body }];
}

// Webhook com a chave ligada. Devolve { status, body } para o handler responder.
export async function acceptWebhook(db, { companyId, instanceName, event, body }) {
  const rows = buildInboundRows({ companyId, instanceName, event, body });
  if (!rows.length) return { status: 200, body: { ok: true, events: 0 } };

  // 1) Grava cru. Reenvio da Evolution (mesma mensagem) não duplica.
  const { data: inserted, error } = await db.from('inbound_events')
    .upsert(rows, { onConflict: 'company_id,instance_name,event,message_id', ignoreDuplicates: true })
    .select('id');
  if (error) {
    console.error(`[inbox] gravação falhou (${event}, ${rows.length} evento(s)): ${error.message}`);
    return { status: 503, body: { error: 'inbox_unavailable' } };  // a Evolution reenvia
  }

  // 2) Processa já o que acabou de entrar. Falha aqui NÃO muda a resposta: está gravado.
  const ids = (inserted || []).map(r => r.id);
  const summary = await processEventsByIds(db, ids);
  return { status: 200, body: { ok: true, events: rows.length, ...summary } };
}

// Reserva os eventos (pending/failed) para este processador e processa.
export async function processEventsByIds(db, ids) {
  if (!ids.length) return { processed: 0, failed: 0 };
  // Linhas recém-gravadas (attempts 0): a reserva já conta a 1ª tentativa, para uma função
  // morta no meio não "esconder" a tentativa.
  const { data: claimed, error } = await db.from('inbound_events')
    .update({ status: 'processing', locked_at: new Date().toISOString(), attempts: 1 })
    .in('id', ids).eq('status', 'pending')
    .select('*');
  if (error) {
    console.error(`[inbox] reserva falhou: ${error.message}`); // o processador pega depois
    return { processed: 0, failed: 0, deferred: ids.length };
  }
  return processClaimed(db, claimed || []);
}

// Processa eventos já reservados (attempts = número desta tentativa) e grava o resultado.
export async function processClaimed(db, events, { deadline = Infinity } = {}) {
  let processed = 0, failed = 0, skipped = 0;
  for (const ev of events) {
    if (Date.now() > deadline) {
      // Sem tempo: devolve para a fila sem contar tentativa.
      await db.from('inbound_events').update({ status: 'pending', locked_at: null, attempts: Math.max(0, ev.attempts - 1) }).eq('id', ev.id);
      skipped++;
      continue;
    }
    const ok = await processEvent(db, ev);
    ok ? processed++ : failed++;
  }
  return { processed, failed, skipped };
}

export async function processEvent(db, ev, dispatch) {
  try {
    let result;
    if (ev.event === 'messages.upsert') {
      result = await processIncomingMessage(db, {
        companyId: ev.company_id, instanceName: ev.instance_name, msg: ev.payload || {}, eventId: ev.id, dispatch,
      });
    } else if (ev.event === 'connection.update') {
      const r = await applyConnectionUpdate(db, { companyId: ev.company_id, instanceName: ev.instance_name, body: ev.payload });
      if (r?.error) throw new Error(`status da conexão não gravado: ${r.error.message}`);
      result = { ok: true };
    } else {
      result = { ignored: 'evento_nao_tratado' };
    }
    await db.from('inbound_events').update({
      status: result?.ignored ? 'ignored' : 'done',
      processed_at: new Date().toISOString(), locked_at: null,
      last_error: result?.ignored || null,
      attempts: ev.attempts,
    }).eq('id', ev.id);
    return true;
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    const dead = ev.attempts >= MAX_ATTEMPTS;
    console.error(`[inbox] evento ${ev.id} falhou (tentativa ${ev.attempts}${dead ? ', MORTO' : ''}): ${msg}`);
    await db.from('inbound_events').update({
      status: dead ? 'dead' : 'failed',
      last_error: msg, locked_at: null, attempts: ev.attempts,
      next_attempt_at: new Date(Date.now() + retryDelaySeconds(ev.attempts) * 1000).toISOString(),
    }).eq('id', ev.id);
    return false;
  }
}

// Processador (A3): pega os vencidos (claim_inbound_events já soma a tentativa) até o prazo.
// cleanup: false quando a retenção (DATA_RETENTION=on, api/_lib/retention.js) cuida da limpeza.
export async function processDueEvents(db, { limit = 50, deadline = Date.now() + 8_000, cleanup = true } = {}) {
  const { data, error } = await db.rpc('claim_inbound_events', { p_limit: limit });
  if (error) return { error: error.message };
  const summary = await processClaimed(db, data || [], { deadline });
  const cleaned = cleanup ? await cleanupInbound(db) : null;
  return { claimed: (data || []).length, ...summary, ...(cleaned ? { cleaned } : {}) };
}

// Limpeza (regra 4 da Parte 2): eventos concluídos/ignorados com mais de 30 dias saem.
// No máximo uma vez por hora por instância da função. Mortos e falhas nunca são apagados aqui.
let lastCleanup = 0;
export async function cleanupInbound(db, { now = Date.now() } = {}) {
  if (now - lastCleanup < 3_600_000) return null;
  lastCleanup = now;
  const cutoff = new Date(now - 30 * 86_400_000).toISOString();
  const { error } = await db.from('inbound_events').delete()
    .in('status', ['done', 'ignored']).lt('received_at', cutoff);
  return error ? { error: error.message } : { ok: true };
}
