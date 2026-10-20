import { adminClient, twinJid } from './db.js';
import { dispatchWebhook } from './webhooks.js';
import { isFeatureOn } from './features.js';

// Estados possíveis de uma conversa. Vocabulário genérico: o Flowmate não sabe o que é "IA",
// ele sabe o que é automação.
export const STATE = { AUTOMATION: 'automation', HUMAN: 'human' };

// Casa dois telefones pelos últimos 8 dígitos (resolve o 9º dígito brasileiro).
function samePhone(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db) return false;
  return da.endsWith(db) || db.endsWith(da) || da.slice(-8) === db.slice(-8);
}

// Tenta achar o contato do CRM correspondente ao número (best-effort).
async function findContactId(companyId, remoteJid, admin = adminClient()) {
  // JIDs de grupo (@g.us), broadcast e newsletter NÃO são pessoas — nunca
  // vincula a um contato do CRM (os dígitos do JID poderiam casar por acaso).
  const jid = String(remoteJid || '');
  if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) return null;

  const phone = jid.replace(/@.*/, '').replace(/\D/g, '');
  if (!phone) return null;
  const { data: contacts } = await admin
    .from('crm_contacts').select('id, phone').eq('company_id', companyId).not('phone', 'is', null);
  const match = (contacts || []).find(c => samePhone(c.phone, phone));
  return match?.id || null;
}

// Busca a conversa; se não existir, cria em 'automation' (default).
// Chaveada por (company_id, remote_jid) — contact_id é vinculado quando existe contato no CRM.
//
// P1-E0b — NUNCA grava automation sobre uma conversa existente:
// - leitura com erro → devolve null (não cria, não sobrescreve). Quem chama trata null como
//   "estado desconhecido": envio automático → 409; webhook → não repassa message.received.
// - criação com INSERT (não upsert): se outra requisição criou no meio-tempo (23505), relê;
//   se a releitura falhar, null. Antes, um upsert com onConflict sobrescrevia o state.
// admin é parâmetro só para teste (padrão: o cliente do servidor).
export async function getOrCreateConversation(companyId, remoteJid, admin = adminClient()) {
  const read = () => admin.from('conversations').select('*')
    .eq('company_id', companyId).eq('remote_jid', remoteJid).maybeSingle();

  const { data: existing, error: readErr } = await read();
  if (readErr) {
    console.error('[conversations] leitura falhou; estado desconhecido:', readErr.message || readErr);
    return null;
  }

  if (existing) {
    // Vincula o contato se ele passou a existir depois
    if (!existing.contact_id) {
      const contactId = await findContactId(companyId, remoteJid, admin);
      if (contactId) {
        await admin.from('conversations').update({ contact_id: contactId }).eq('id', existing.id);
        existing.contact_id = contactId;
      }
    }
    return existing;
  }

  const contactId = await findContactId(companyId, remoteJid, admin);
  const { data: created, error: insErr } = await admin
    .from('conversations')
    .insert({
      company_id: companyId,
      remote_jid: remoteJid,
      contact_id: contactId,
      state: STATE.AUTOMATION,
      state_since: new Date().toISOString(),
    })
    .select().single();
  if (!insErr) {
    // Etiquetas (chave labels): o gatilho do banco pôs "Atendimento IA" na conversa nova.
    await emitLabelsEvent(admin, created, 'system', null, { onlyIndividual: true });
    return created;
  }

  // Corrida: outra requisição criou a mesma conversa. Usa a que está no banco, com o estado dela.
  if (insErr.code === '23505') {
    const { data: again, error: againErr } = await read();
    if (!againErr && again) return again;
  }
  console.error('[conversations] criação falhou; estado desconhecido:', insErr.message || insErr);
  return null;
}

// Conversa gêmea (mesmo celular BR com/sem o 9º dígito, P1-E0) de uma conversa individual.
// null quando não há gêmea ou ela não existe. error: true quando a leitura falhou.
export async function findTwinConversation(companyId, remoteJid, admin = adminClient()) {
  const twin = twinJid(remoteJid);
  if (!twin) return { twin: null, error: false };
  const { data, error } = await admin.from('conversations').select('id, state, remote_jid')
    .eq('company_id', companyId).eq('remote_jid', twin).maybeSingle();
  return { twin: data || null, error: !!error };
}

// "Devolver para automação" (tela e PATCH /v1/conversations/{id}, P1-E0b): retoma a conversa
// e também a gêmea em human, senão a automação ficaria presa em 409 sem motivo visível.
// Retoma a gêmea mesmo que ela tenha sido pausada por outro caminho (é o mesmo celular e a
// ordem é explícita). Cada conversa que muda gera o seu conversation.state_changed.
// Devolve os ids que mudaram de fato.
// opts.quietLabelsFor: id da conversa cujo conversation.labels_updated quem chamou solta
// (aplicar etiqueta pela API/tela junta tudo num evento só).
export async function resumeAutomation(conversation, companyId, actorUserId, source, admin = adminClient(), opts = {}) {
  const changed = [];
  const quiet = id => ({ quietLabels: opts.quietLabelsFor === id });
  if (conversation.state !== STATE.AUTOMATION) {
    await setConversationState(conversation.id, STATE.AUTOMATION, actorUserId, source, admin, quiet(conversation.id));
    changed.push(conversation.id);
  }
  const { twin, error } = await findTwinConversation(companyId, conversation.remote_jid, admin);
  if (error) console.error('[conversations] gêmea não lida ao retomar; o envio segue em 409 se ela estiver em human');
  if (twin && twin.state !== STATE.AUTOMATION) {
    await setConversationState(twin.id, STATE.AUTOMATION, actorUserId, source, admin, quiet(twin.id));
    changed.push(twin.id);
  }
  return changed;
}

// ET-3 (chave labels ligada): a marcação humana vale também para a GÊMEA (mesmo celular com/sem o
// 9º dígito). Chamada depois de marcar a própria conversa (envio pela tela, resposta pelo
// celular). Desligada = nada (hoje a gêmea só conta no 409 e no "devolver"). Nunca derruba o
// fluxo de mensagens: erro só no log.
export async function markTwinHuman(companyId, conversation, actorUserId, source, admin = adminClient()) {
  try {
    if (!conversation?.remote_jid || !(await isFeatureOn(companyId, 'labels', admin))) return;
    const { twin, error } = await findTwinConversation(companyId, conversation.remote_jid, admin);
    if (error) { console.error('[conversations] gêmea não lida; Atendimento humano só na própria conversa'); return; }
    if (twin && twin.state !== STATE.HUMAN) {
      const r = await setConversationState(twin.id, STATE.HUMAN, actorUserId, source, admin);
      if (r?.error) console.error('[conversations] gêmea não marcada:', r.error.message || r.error);
    }
  } catch (e) { console.error('[conversations] marcação da gêmea falhou:', e?.message || e); }
}

// Etiquetas (PLANO-ETIQUETAS, só com a chave labels ligada): conversation.labels_updated quando
// o estado muda (o gatilho do banco troca a etiqueta de sistema) e na conversa nova. Nunca
// derruba nem segura o fluxo de mensagens: try/catch e limite de 3 s; chave desligada = só a
// leitura da chave (em cache).
const SYSTEM_KEY = { [STATE.HUMAN]: 'human', [STATE.AUTOMATION]: 'ai' };
function isIndividualJid(jid) {
  const s = String(jid || '');
  return !!s && !s.endsWith('@g.us') && !s.endsWith('@broadcast') && !s.endsWith('@newsletter');
}
async function emitLabelsEvent(admin, conv, source, actorUserId, { prevState = null, newState = null, onlyIndividual = false } = {}) {
  try {
    if (!conv?.company_id || (onlyIndividual && !isIndividualJid(conv.remote_jid))) return;
    if (!(await isFeatureOn(conv.company_id, 'labels', admin))) return;
    const { data, error } = await admin.from('conversation_labels')
      .select('label:labels(id, name, color, kind, system_key)')
      .eq('company_id', conv.company_id).eq('conversation_id', conv.id);
    if (error) throw error;
    const all = (data || []).map(r => r.label).filter(Boolean);
    const brief = l => ({ id: l.id, name: l.name, color: l.color, kind: l.kind });
    let added, removed = [];
    if (newState) {
      added = all.filter(l => l.system_key === SYSTEM_KEY[newState]).map(brief);
      if (prevState && SYSTEM_KEY[prevState]) {
        const { data: prev } = await admin.from('labels').select('id, name, color, kind')
          .eq('company_id', conv.company_id).eq('system_key', SYSTEM_KEY[prevState]).maybeSingle();
        if (prev) removed = [brief(prev)];
      }
    } else {
      added = all.map(brief);
    }
    if (!added.length && !removed.length) return;
    await Promise.race([
      dispatchWebhook(conv.company_id, 'conversation.labels_updated', {
        conversation_id: conv.id, contact_id: conv.contact_id ?? null, remote_jid: conv.remote_jid,
        labels: all.map(brief), added, removed, source, user_id: actorUserId || null,
      }),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
  } catch (e) { console.error('[conversations] evento de etiquetas falhou:', e?.message || e); }
}

// Transiciona o estado da conversa. state_by = usuário que pausou (null se veio do celular).
// source diz quem mudou ('user' tela, 'api', 'phone' celular); sem source, deduz pelo actor
// (com usuário = 'user', sem = 'phone') — assim sendMessage e handleWebhook não mudam.
// Se o estado mudou de fato, dispara conversation.state_changed (P1-W1).
// opts.quietLabels: não solta conversation.labels_updated (quem chamou solta um evento só).
export async function setConversationState(conversationId, state, actorUserId = null, source = null, admin = adminClient(), opts = {}) {
  let before = null;
  try {
    const { data } = await admin.from('conversations')
      .select('company_id, contact_id, remote_jid, state').eq('id', conversationId).maybeSingle();
    before = data;
  } catch (e) { console.error('[conversations] leitura antes da troca falhou:', e?.message || e); }

  const { error: updErr } = await admin.from('conversations').update({
    state,
    state_since: new Date().toISOString(),
    state_by: actorUserId,
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId);
  // Devolve o erro (a caixa de entrada da CF-A usa para tentar de novo; os demais ignoram).
  if (updErr) return { error: updErr };

  // O webhook do cliente nunca pode derrubar nem segurar a troca de estado: este código também
  // roda no fluxo de mensagens (dono respondeu pelo celular). try/catch + limite de 3 s.
  if (before && before.state !== state) {
    try {
      await Promise.race([
        dispatchWebhook(before.company_id, 'conversation.state_changed', {
          conversation_id: conversationId,
          contact_id: before.contact_id,
          remote_jid: before.remote_jid,
          state,
          previous_state: before.state,
          changed_by: source || (actorUserId ? 'user' : 'phone'),
          user_id: actorUserId,
        }),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch (e) { console.error('[conversations] webhook state_changed falhou:', e?.message || e); }
    if (!opts.quietLabels) {
      await emitLabelsEvent(admin, { id: conversationId, ...before }, source || (actorUserId ? 'user' : 'phone'), actorUserId,
        { prevState: before.state, newState: state, onlyIndividual: true });
    }
  }
  return { ok: true };
}

// Uma mensagem fromMe cujo message_id o Flowmate NÃO conhece foi enviada do celular do dono.
// Esse é o caso que quebra tudo se for esquecido: a recepcionista responde pelo celular
// e a automação atropela por cima.
// Filtrado por empresa (CF-A A2): o mesmo message_id pode existir em outra empresa (uma
// empresa escreve para a outra, ou as duas estão no mesmo grupo).
export async function isKnownOutgoing(messageId, companyId, admin = adminClient()) {
  if (!messageId) return false;
  let q = admin.from('whatsapp_messages').select('id').eq('message_id', messageId);
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q.limit(1);
  return !!(data && data.length);
}
