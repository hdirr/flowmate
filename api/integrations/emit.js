import { resolveUser, adminClient } from '../_lib/db.js';
import { dispatchWebhook } from '../_lib/webhooks.js';

// Emissor de eventos de CRM (contact.created, lead.created, lead.moved), chamado pela UI.
// O evento message.received é emitido direto pelo webhook da Evolution (server-side),
// usando o mesmo dispatchWebhook.
//
// O servidor assina o que entrega, então não pode assinar o que o navegador inventar:
// lista fechada de eventos, e do `data` recebido só se usa o id — o payload é montado
// aqui, lendo do banco com filtro de company_id. Os campos são os mesmos que o
// store.js mandava (o n8n de quem consome não percebe diferença).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUILDERS = {
  'contact.created': async (admin, companyId, data) => {
    const id = data?.contact_id;
    if (!UUID_RE.test(String(id || ''))) return null;
    const { data: c } = await admin.from('crm_contacts')
      .select('id, name, phone, email').eq('company_id', companyId).eq('id', id).maybeSingle();
    return c ? { contact_id: c.id, name: c.name, phone: c.phone, email: c.email } : null;
  },
  'lead.created': leadPayload,
  'lead.moved': leadPayload,
};

async function leadPayload(admin, companyId, data) {
  const id = data?.lead_id;
  if (!UUID_RE.test(String(id || ''))) return null;
  const { data: l } = await admin.from('crm_leads')
    .select('id, stage_id, pipeline_id, contact_id').eq('company_id', companyId).eq('id', id).maybeSingle();
  return l ? { lead_id: l.id, stage_id: l.stage_id, pipeline_id: l.pipeline_id, contact_id: l.contact_id } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { event, data } = req.body || {};
  const build = Object.prototype.hasOwnProperty.call(BUILDERS, event) ? BUILDERS[event] : null;
  if (!build) return res.status(400).json({ error: 'event_not_allowed' });

  const payload = await build(adminClient(), who.companyId, data);
  if (!payload) return res.status(404).json({ error: 'not_found' });

  const result = await dispatchWebhook(who.companyId, event, payload);
  return res.status(200).json({ ok: true, ...result });
}
