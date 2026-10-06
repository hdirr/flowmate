import { adminClient, resolveUser, jidFor, twinJid } from '../_lib/db.js';
import { getOrCreateConversation, setConversationState, resumeAutomation, STATE } from '../_lib/conversations.js';

// GET  /api/conversations/state?to=5531999998888   → { state, state_since, state_by }
// POST /api/conversations/state  { to, state }     → transiciona (retomada manual)
//
// human → automation é SEMPRE manual. Nada de auto-retomada por tempo: o dono foi almoçar
// e a automação voltaria do nada dizendo "Como posso ajudar?".
//
// Conversa gêmea (mesmo celular BR com/sem o 9º dígito, P1-E0b): o GET mostra human se
// qualquer uma das duas estiver em human (é o que o envio automático respeita), e "devolver
// para automação" retoma as duas.
export default async function handler(req, res) {
  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const to = req.method === 'GET' ? req.query?.to : req.body?.to;
  if (!to) return res.status(400).json({ error: 'Parâmetro "to" obrigatório' });

  const remoteJid = jidFor(to);

  if (req.method === 'GET') {
    const admin = adminClient();
    const twin = twinJid(remoteJid);
    const { data, error } = await admin
      .from('conversations')
      .select('id, remote_jid, state, state_since, state_by')
      .eq('company_id', who.companyId)
      .in('remote_jid', twin ? [remoteJid, twin] : [remoteJid]);
    // Leitura falhou: não afirma "automação" (a tela mantém o que já mostrava).
    if (error) return res.status(503).json({ error: 'state_unavailable' });
    const list = data || [];
    const pick = list.find(c => c.state !== STATE.AUTOMATION) || list.find(c => c.remote_jid === remoteJid) || list[0];
    // Sem conversa ainda = automação (default)
    if (!pick) return res.status(200).json({ state: STATE.AUTOMATION, state_since: null, state_by: null });
    return res.status(200).json({ id: pick.id, state: pick.state, state_since: pick.state_since, state_by: pick.state_by });
  }

  if (req.method === 'POST') {
    const { state } = req.body || {};
    if (state !== STATE.AUTOMATION && state !== STATE.HUMAN) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const conversation = await getOrCreateConversation(who.companyId, remoteJid);
    if (!conversation) return res.status(503).json({ error: 'conversation_unavailable' });
    // source 'user': veio do botão da tela (ao devolver para automação o actor vai nulo e,
    // sem isto, o evento sairia como 'phone').
    if (state === STATE.AUTOMATION) {
      await resumeAutomation(conversation, who.companyId, null, 'user');
    } else {
      await setConversationState(conversation.id, state, who.userId, 'user');
    }
    return res.status(200).json({ ok: true, state });
  }

  return res.status(405).end();
}
