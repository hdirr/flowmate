import { resolveUser } from '../_lib/db.js';
import { sendMessage } from '../_lib/sendMessage.js';

// Boca da UI (e dos bots que rodam no navegador). Autentica por JWT.
// A regra de estado vive em sendMessage() — a mesma que o /v1/messages usa.
//
// body: { to, message, sender?: 'human' | 'automation' }
//   - chat da UI  → sender: 'human'      (assume a conversa)
//   - automações  → sender: 'automation' (sujeito ao 409)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { to, message, sender = 'human' } = req.body || {};

  const result = await sendMessage({
    companyId: who.companyId,
    to,
    content: message,
    sender,
    actorUserId: sender === 'human' ? who.userId : null,
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(200).json(result);
}
