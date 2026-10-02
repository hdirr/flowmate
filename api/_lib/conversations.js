import { adminClient } from './db.js';
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
async function findContactId(companyId, remoteJid) {
  // JIDs de grupo (@g.us), broadcast e newsletter NÃO são pessoas — nunca
  // vincula a um contato do CRM (os dígitos do JID poderiam casar por acaso).
  const jid = String(remoteJid || '');
  if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) return null;

  const phone = jid.replace(/@.*/, '').replace(/\D/g, '');
  if (!phone) return null;
  const admin = adminClient();
  const { data: contacts } = await admin
    .from('crm_contacts').select('id, phone').eq('company_id', companyId).not('phone', 'is', null);
  const match = (contacts || []).find(c => samePhone(c.phone, phone));
  return match?.id || null;
}

// Busca a conversa; se não existir, cria em 'automation' (default).
// Chaveada por (company_id, remote_jid) — contact_id é vinculado quando existe contato no CRM.
export async function getOrCreateConversation(companyId, remoteJid) {
  const admin = adminClient();

  const { data: existing } = await admin
    .from('conversations')
    .select('*')
    .eq('company_id', companyId)
    .eq('remote_jid', remoteJid)
    .single();

  if (existing) {
    // Vincula o contato se ele passou a existir depois
    if (!existing.contact_id) {
      const contactId = await findContactId(companyId, remoteJid);
      if (contactId) {
        await admin.from('conversations').update({ contact_id: contactId }).eq('id', existing.id);
        existing.contact_id = contactId;
      }
    }
    return existing;
  }

  const contactId = await findContactId(companyId, remoteJid);
  const { data: created } = await admin
    .from('conversations')
    .upsert({
      company_id: companyId,
      remote_jid: remoteJid,
      contact_id: contactId,
      state: STATE.AUTOMATION,
      state_since: new Date().toISOString(),
    }, { onConflict: 'company_id,remote_jid' })
    .select().single();

  return created;
}

// Transiciona o estado da conversa. state_by = usuário que pausou (null se veio do celular).
// source diz quem mudou ('user' tela, 'api', 'phone' celular); sem source, deduz pelo actor
// (com usuário = 'user', sem = 'phone') — assim sendMessage e handleWebhook não mudam.
// Se o estado mudou de fato, dispara conversation.state_changed (P1-W1).
export async function setConversationState(conversationId, state, actorUserId = null, source = null) {
  const admin = adminClient();
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
