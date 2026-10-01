// Roteador por segmentos das rotas novas da /v1. Tudo continua num arquivo de função só
// (api/v1/[...path].js) por causa do limite de 12 funções do plano Hobby da Vercel.
//
// Cada rota: { method, pattern, handler }, com pattern tipo 'leads/:id/notes'.
// handler(req, res, { companyId, params }).
//
// Rotas que não casam aqui caem no switch antigo do [...path].js, sem mudança.

import { listPipelines } from './pipelines.js';
import { listLeads } from './leads.js';

export const ROUTES = [
  // As rotas entram uma por tarefa (P1-L*, P1-E*).
  { method: 'GET', pattern: 'pipelines', handler: listPipelines }, // P1-L1
  { method: 'GET', pattern: 'leads', handler: listLeads },         // P1-L2 (POST leads segue no switch antigo)
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
