import { resolveApiKey } from '../_lib/db.js';
import { handleMessages, handleLeads, handleContacts, handleFields, handleNotes } from '../_lib/v1handlers.js';
import { match } from '../_lib/v1/router.js';
import { fail, V1Error } from '../_lib/v1/http.js';

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
// "Bearer <chave>" (prefixo sem diferenciar caixa) → chave. Sem prefixo ou vazio → null,
// e a leitura segue para a próxima opção. Formato da Helena e da credencial Bearer do n8n.
// Rotas atendidas pelo switch antigo (v1handlers.js). Não mudam de resposta.
const LEGACY_ROUTES = new Set(['fields', 'contacts', 'leads', 'messages', 'notes']);

function bearerKey(header) {
  const m = /^bearer\s+(.+)$/i.exec(String(header || '').trim());
  return m ? m[1].trim() || null : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Rota = caminho público. Fora do Next.js a Vercel trata [...path] como UM segmento, então o
  // vercel.json manda toda a /v1 para /api/v1/__r?__p=<caminho> (P1-B3). O req.url continua
  // com o caminho público (/v1/leads/x) — ele é a fonte principal, porque o cliente não forja;
  // o __p (que vem na query e poderia ser enviado pelo cliente) fica só de reserva.
  const pathname = (req.url || '').split('?')[0];
  let route = pathname.replace(/^\/(api\/)?v1\/?/, '').replace(/\/+$/, '');
  if (!route || route === '__r') route = String(req.query?.__p || '').replace(/\/+$/, '');

  // Ordem: x-api-key → Authorization: Bearer → ?key= (compatibilidade). Vale a primeira preenchida.
  // Aqui o Bearer é a CHAVE DA INTEGRAÇÃO (company_integrations.api_key), não o JWT do Supabase.
  const apiKey = req.headers['x-api-key'] || bearerKey(req.headers.authorization) || req.query?.key;
  const companyId = await resolveApiKey(apiKey);
  if (!companyId) return res.status(401).json({ error: 'invalid_api_key' });

  // 1º as rotas novas (tabela por segmentos, ex.: 'leads/:id/notes'). Se nenhuma casar,
  // segue para o switch antigo, que fica exatamente como era (as integrações dependem dele).
  // Caminho que também existe no switch antigo (ex.: GET leads é novo, POST leads é antigo):
  // método que a tabela nova não tem segue para o handler antigo, sem virar 405 aqui.
  const found = match(req.method, route);
  if (found?.methodNotAllowed && !LEGACY_ROUTES.has(route)) {
    return fail(res, 405, 'method_not_allowed', `Método ${req.method} não aceito nesta rota. Use: ${found.allow.join(', ')}.`);
  }
  if (found?.handler) {
    try {
      return await found.handler(req, res, { companyId, params: found.params });
    } catch (e) {
      if (e instanceof V1Error) return fail(res, e.status, e.error, e.message);
      throw e;
    }
  }

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
