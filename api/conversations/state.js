import { adminClient, resolveUser, jidFor } from '../_lib/db.js';
import { getOrCreateConversation, setConversationState, STATE } from '../_lib/conversations.js';

// GET  /api/conversations/state?to=5531999998888   → { state, state_since, state_by }
// POST /api/conversations/state  { to, state }     → transiciona (retomada manual)
//
// human → automation é SEMPRE manual. Nada de auto-retomada por tempo: o dono foi almoçar
// e a automação voltaria do nada dizendo "Como posso ajudar?".
export default async function handler(req, res) {
  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const to = req.method === 'GET' ? req.query?.to : req.body?.to;
  if (!to) return res.status(400).json({ error: 'Parâmetro "to" obrigatório' });

  const remoteJid = jidFor(to);

  if (req.method === 'GET') {
    const admin = adminClient();
    const { data } = await admin
      .from('conversations')
      .select('id, state, state_since, state_by')
      .eq('company_id', who.companyId)
      .eq('remote_jid', remoteJid)
      .single();
    // Sem conversa ainda = automação (default)
    return res.status(200).json(data || { state: STATE.AUTOMATION, state_since: null, state_by: null });
  }

  if (req.method === 'POST') {
    const { state } = req.body || {};
    if (state !== STATE.AUTOMATION && state !== STATE.HUMAN) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const conversation = await getOrCreateConversation(who.companyId, remoteJid);
    await setConversationState(conversation.id, state, state === STATE.HUMAN ? who.userId : null);
    return res.status(200).json({ ok: true, state });
  }

  return res.status(405).end();
}
