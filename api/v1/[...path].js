import { resolveApiKey } from '../_lib/db.js';
import { handleMessages, handleLeads } from '../_lib/v1handlers.js';

/**
 * API pública v1 — a boca do n8n. Autentica por API key do tenant.
 *
 *   POST /v1/messages   → envia (sender = automation, 409 se a conversa está em human)
 *   POST /v1/leads      → cria lead idempotente por external_id
 *
 * Um único handler para todas as rotas v1: o plano Hobby do Vercel limita
 * o número de serverless functions, então roteamos aqui dentro.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const segments = req.query?.path || [];
  const route = Array.isArray(segments) ? segments.join('/') : String(segments);

  const apiKey = req.headers['x-api-key'] || req.query?.key;
  const companyId = await resolveApiKey(apiKey);
  if (!companyId) return res.status(401).json({ error: 'invalid_api_key' });

  if (route === 'messages') return handleMessages(req, res, companyId);
  if (route === 'leads')    return handleLeads(req, res, companyId);

  return res.status(404).json({ error: 'not_found', route });
}
