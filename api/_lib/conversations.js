import { adminClient, twinJid } from './db.js';
import { dispatchWebhook } from './webhooks.js';

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
  if (!insErr) return created;

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
export async function resumeAutomation(conversation, companyId, actorUserId, source, admin = adminClient()) {
  const changed = [];
  if (conversation.state !== STATE.AUTOMATION) {
    await setConversationState(conversation.id, STATE.AUTOMATION, actorUserId, source, admin);
    changed.push(conversation.id);
  }
  const { twin, error } = await findTwinConversation(companyId, conversation.remote_jid, admin);
  if (error) console.error('[conversations] gêmea não lida ao retomar; o envio segue em 409 se ela estiver em human');
  if (twin && twin.state !== STATE.AUTOMATION) {
    await setConversationState(twin.id, STATE.AUTOMATION, actorUserId, source, admin);
    changed.push(twin.id);
  }
  return changed;
}

// Transiciona o estado da conversa. state_by = usuário que pausou (null se veio do celular).
// source diz quem mudou ('user' tela, 'api', 'phone' celular); sem source, deduz pelo actor
// (com usuário = 'user', sem = 'phone') — assim sendMessage e handleWebhook não mudam.
// Se o estado mudou de fato, dispara conversation.state_changed (P1-W1).
export async function setConversationState(conversationId, state, actorUserId = null, source = null, admin = adminClient()) {
  let before = null;
  try {
    const { data } = await admin.from('conversations')
      .select('company_id, contact_id, remote_jid, state').eq('id', conversationId).maybeSingle();
    before = data;
  } catch (e) { console.error('[conversations] leitura antes da troca falhou:', e?.message || e); }

  await admin.from('conversations').update({
    state,
    state_since: new Date().toISOString(),
    state_by: actorUserId,
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId);

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
  }
}

// Uma mensagem fromMe cujo message_id o Flowmate NÃO conhece foi enviada do celular do dono.
// Esse é o caso que quebra tudo se for esquecido: a recepcionista responde pelo celular
// e a automação atropela por cima.
export async function isKnownOutgoing(messageId) {
  if (!messageId) return false;
  const admin = adminClient();
  const { data } = await admin
    .from('whatsapp_messages').select('id').eq('message_id', messageId).limit(1);
  return !!(data && data.length);
}
