import { resolveApiKey } from '../_lib/db.js';
import { handleMessages, handleLeads, handleContacts, handleFields, handleNotes } from '../_lib/v1handlers.js';

/**
 * API pública v1 — a boca e as mãos do n8n. Autentica por API key do tenant.
 *
 *   GET   /v1/fields      → lista os campos personalizados (o agente descobre os ids/nomes)
 *   GET   /v1/contacts    → lê contato + campos + lead + estado da conversa   (?phone= | ?external_id= | ?id=)
 *   PATCH /v1/contacts    → escreve nome/email/tags/campos personalizados e move de etapa
 *   POST  /v1/leads       → cria lead (idempotente por external_id, aceita campos)
 *   GET   /v1/messages    → histórico da conversa (?phone=&limit=)
 *   POST  /v1/messages    → envia (sender = automation; 409 se a conversa está em human)
 *   POST  /v1/notes       → registra nota interna no contato
 *
 * Tudo num handler só: o plano Hobby do Vercel limita o número de serverless functions.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Deriva a rota da URL: via rewrite (/v1/* → /api/v1/*) o parâmetro dinâmico vem vazio.
  const segments = req.query?.path;
  let route = Array.isArray(segments) ? segments.join('/') : (segments || '');
  if (!route) {
    const pathname = (req.url || '').split('?')[0];
    route = pathname.replace(/^\/(api\/)?v1\//, '').replace(/\/+$/, '');
  }

  const apiKey = req.headers['x-api-key'] || req.query?.key;
  const companyId = await resolveApiKey(apiKey);
  if (!companyId) return res.status(401).json({ error: 'invalid_api_key' });

  switch (route) {
    case 'fields':   return handleFields(req, res, companyId);
    case 'contacts': return handleContacts(req, res, companyId);
    case 'leads':    return handleLeads(req, res, companyId);
    case 'messages': return handleMessages(req, res, companyId);
    case 'notes':    return handleNotes(req, res, companyId);
    default:
      return res.status(404).json({ error: 'not_found', route });
  }
}
