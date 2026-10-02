// Roteador por segmentos das rotas novas da /v1. Tudo continua num arquivo de função só
// (api/v1/[...path].js) por causa do limite de 12 funções do plano Hobby da Vercel.
//
// Cada rota: { method, pattern, handler }, com pattern tipo 'leads/:id/notes'.
// handler(req, res, { companyId, params }).
//
// Rotas que não casam aqui caem no switch antigo do [...path].js, sem mudança.

import { listPipelines } from './pipelines.js';
import { listLeads, getLead, listLeadNotes, updateLead, createLeadNote } from './leads.js';
import { listContacts, updateContactTags } from './contacts.js';
import { listUsers } from './users.js';
import { getMessage } from './messages.js';
import { listWebhookEvents } from './webhookEvents.js';
import { listConversations, getConversation, listConversationMessages, updateConversation, sendConversationMessage } from './conversations.js';

export const ROUTES = [
  // As rotas entram uma por tarefa (P1-L*, P1-E*).
  { method: 'GET', pattern: 'pipelines', handler: listPipelines }, // P1-L1
  { method: 'GET', pattern: 'leads', handler: listLeads },         // P1-L2 (POST leads segue no switch antigo)
  { method: 'GET', pattern: 'leads/:id', handler: getLead },       // P1-L3
  { method: 'PATCH', pattern: 'leads/:id', handler: updateLead },  // P1-E4
  { method: 'GET', pattern: 'leads/:id/notes', handler: listLeadNotes }, // P1-L11
  { method: 'POST', pattern: 'leads/:id/notes', handler: createLeadNote }, // P1-E5
  { method: 'GET', pattern: 'users', handler: listUsers },         // P1-L5
  { method: 'GET', pattern: 'conversations', handler: listConversations }, // P1-L6
  { method: 'GET', pattern: 'conversations/:id', handler: getConversation }, // P1-L7
  { method: 'PATCH', pattern: 'conversations/:id', handler: updateConversation }, // P1-E6
  { method: 'GET', pattern: 'conversations/:id/messages', handler: listConversationMessages }, // P1-L8
  { method: 'POST', pattern: 'conversations/:id/messages', handler: sendConversationMessage }, // P1-E7
  { method: 'GET', pattern: 'messages/:id', handler: getMessage }, // P1-L9 (GET/POST /v1/messages antigos seguem no switch)
  { method: 'GET', pattern: 'webhook-events', handler: listWebhookEvents }, // P1-L10
  { method: 'GET', pattern: 'contacts', handler: listContacts },
  { method: 'POST', pattern: 'contacts/:id/tags', handler: updateContactTags }, // P1-E3   // P1-L4 (com phone/id/external_id delega à rota antiga; PATCH/POST seguem no switch)
];

function splitRoute(route) {
  return String(route || '').split('/').filter(Boolean);
}

function matchPattern(pattern, segments) {
  const parts = splitRoute(pattern);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      try { params[parts[i].slice(1)] = decodeURIComponent(segments[i]); }
      catch { return null; } // %-encoding quebrado: trata como rota que não casa
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

// Devolve:
//   { handler, params }              → rota e método casaram
//   { methodNotAllowed: true, allow } → o caminho existe, mas não com este método (405)
//   null                             → nenhuma rota nova casa (segue para o switch antigo)
export function match(method, route, routes = ROUTES) {
  const segments = splitRoute(route);
  const allow = [];
  for (const r of routes) {
    const params = matchPattern(r.pattern, segments);
    if (!params) continue;
    if (r.method === method) return { handler: r.handler, params };
    allow.push(r.method);
  }
  return allow.length ? { methodNotAllowed: true, allow } : null;
}
