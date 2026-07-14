import { resolveApiKey } from '../_lib/db.js';
import { sendMessage } from '../_lib/sendMessage.js';

/**
 * POST /v1/messages — a boca do n8n.
 *
 * Header: x-api-key: <api key do tenant>
 * Body:   { to, content, media?: { url, type, mimeType?, fileName? } }
 *
 * Sempre sender = 'automation'. Se a conversa estiver em 'human', responde
 * 409 { error: 'conversation_paused' } e NÃO entrega nada.
 * O consumidor não precisa checar estado — a pausa é imposta aqui.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const apiKey = req.headers['x-api-key'] || req.query?.key;
  const companyId = await resolveApiKey(apiKey);
  if (!companyId) return res.status(401).json({ error: 'invalid_api_key' });

  const { to, content, media } = req.body || {};
  if (!to) return res.status(400).json({ error: 'missing_to' });
  if (!content && !media) return res.status(400).json({ error: 'missing_content' });

  const result = await sendMessage({
    companyId,
    to,
    content,
    media: media || null,
    sender: 'automation',
  });

  if (result.error) {
    // 409 conversation_paused = o humano assumiu. Não é erro do consumidor: é a regra.
    return res.status(result.status || 400).json({
      error: result.error,
      conversation_id: result.conversationId || null,
    });
  }

  return res.status(200).json({
    ok: true,
    message_id: result.messageId,
    conversation_id: result.conversationId,
  });
}
