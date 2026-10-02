import { WEBHOOK_EVENTS } from '../events.js';

// GET /v1/webhook-events — o catálogo de eventos de webhook (fonte: api/_lib/events.js).
// Sem banco e sem paginação (lista curta e fixa). Mostra o CATÁLOGO, não o que a empresa
// assinou: a assinatura é feita na tela de Integrações, onde "nenhum marcado" = recebe todos.
export async function listWebhookEvents(req, res) {
  const items = WEBHOOK_EVENTS.map(e => ({
    event: e.event,
    description: e.description,
    since: e.since,
    available: e.available,
    available_after: e.available_after,
  }));
  return res.status(200).json({ items });
}
