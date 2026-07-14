import { adminClient } from './db.js';

/**
 * Repassa um evento para o webhook configurado do tenant (n8n, Make, script próprio).
 * Server-side: sem CORS, sem JWT. Usado tanto pelo emit.js (eventos de CRM)
 * quanto pelo webhook da Evolution (message.received).
 */
export async function dispatchWebhook(companyId, event, data) {
  if (!companyId || !event) return { skipped: true };

  const admin = adminClient();
  const { data: integ } = await admin
    .from('company_integrations')
    .select('webhook_url, webhook_events, enabled')
    .eq('company_id', companyId)
    .single();

  if (!integ?.enabled || !integ.webhook_url) return { skipped: true };

  // Lista vazia = todos os eventos
  if (integ.webhook_events?.length && !integ.webhook_events.includes(event)) {
    return { skipped: true };
  }

  await fetch(integ.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data, company_id: companyId, timestamp: Date.now() }),
  }).catch(() => {});

  return { ok: true };
}
