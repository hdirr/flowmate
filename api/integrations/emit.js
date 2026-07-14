import { resolveUser } from '../_lib/db.js';
import { dispatchWebhook } from '../_lib/webhooks.js';

// Emissor de eventos de CRM (contact.created, lead.created, lead.moved), chamado pela UI.
// O evento message.received é emitido direto pelo webhook da Evolution (server-side),
// usando o mesmo dispatchWebhook.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { event, data } = req.body || {};
  const result = await dispatchWebhook(who.companyId, event, data);

  return res.status(200).json({ ok: true, ...result });
}
