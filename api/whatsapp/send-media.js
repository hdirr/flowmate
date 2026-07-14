import { resolveUser } from '../_lib/db.js';
import { sendMessage } from '../_lib/sendMessage.js';

// Envio de mídia (foto/vídeo/PDF). Mesma regra de estado do envio de texto:
// mídia disparada por automação numa conversa em 'human' também leva 409.
//
// body: { to, mediaUrl, mediaType, mimeType?, fileName?, caption?, sender? }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { to, mediaUrl, mediaType, mimeType, fileName, caption, sender = 'human' } = req.body || {};
  if (!mediaUrl || !mediaType) return res.status(400).json({ error: 'Parâmetros incompletos' });

  const result = await sendMessage({
    companyId: who.companyId,
    to,
    content: caption || '',
    sender,
    actorUserId: sender === 'human' ? who.userId : null,
    media: { url: mediaUrl, type: mediaType, mimeType, fileName },
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(200).json(result);
}
