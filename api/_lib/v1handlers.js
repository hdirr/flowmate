import { adminClient } from './db.js';
import { sendMessage } from './sendMessage.js';
import { dispatchWebhook } from './webhooks.js';

// ─── helpers ─────────────────────────────────────────────────

function digits(v) { return String(v || '').replace(/\D/g, ''); }

function samePhone(a, b) {
  const da = digits(a), db = digits(b);
  if (!da || !db) return false;
  return da.endsWith(db) || db.endsWith(da) || da.slice(-8) === db.slice(-8);
}

// Acha o contato por id, external_id ou telefone (casando pelos últimos 8 dígitos).
async function resolveContact(companyId, { contact_id, external_id, phone }) {
  const admin = adminClient();

  if (contact_id) {
    const { data } = await admin.from('crm_contacts')
      .select('*').eq('company_id', companyId).eq('id', contact_id).single();
    return data || null;
  }
  if (external_id) {
    const { data } = await admin.from('crm_contacts')
      .select('*').eq('company_id', companyId).eq('external_id', external_id).single();
    return data || null;
  }
  if (phone) {
    const { data } = await admin.from('crm_contacts')
      .select('*').eq('company_id', companyId).not('phone', 'is', null);
    return (data || []).find(c => samePhone(c.phone, phone)) || null;
  }
  return null;
}

// Os valores ficam em crm_contacts.fields, chaveados pelo UUID do campo.
// Um agente não sabe UUID — então aceitamos id OU nome (case-insensitive).
async function resolveFieldKeys(companyId, incoming) {
  const admin = adminClient();
  const { data: defs } = await admin.from('custom_fields')
    .select('id, name, type').eq('company_id', companyId);

  const byId = new Map((defs || []).map(f => [f.id, f]));
  const byName = new Map((defs || []).map(f => [String(f.name).toLowerCase().trim(), f]));

  const resolved = {};
  const unknown = [];

  for (const [key, value] of Object.entries(incoming || {})) {
    const def = byId.get(key) || byName.get(String(key).toLowerCase().trim());
    if (!def) { unknown.push(key); continue; }
    resolved[def.id] = value;
  }
  return { resolved, unknown, defs: defs || [] };
}

// Devolve os campos de forma legível (nome → valor), não por UUID.
function fieldsByName(defs, fieldsJson) {
  const out = {};
  for (const def of defs) {
    if (fieldsJson && Object.prototype.hasOwnProperty.call(fieldsJson, def.id)) {
      out[def.name] = fieldsJson[def.id];
    }
  }
  return out;
}

// Resolve a etapa de destino por id ou nome, e devolve o funil dela.
async function resolveStage(companyId, { stage_id, stage_name, pipeline_name }) {
  const admin = adminClient();

  if (stage_id) {
    const { data } = await admin.from('crm_stages')
      .select('id, pipeline_id').eq('company_id', companyId).eq('id', stage_id).single();
    return data || null;
  }
  if (stage_name) {
    let q = admin.from('crm_stages').select('id, pipeline_id, name, pipeline_id')
      .eq('company_id', companyId).ilike('name', stage_name);
    const { data: stages } = await q;
    if (!stages?.length) return null;
    if (pipeline_name) {
      const { data: pipes } = await admin.from('crm_pipelines')
        .select('id').eq('company_id', companyId).ilike('name', pipeline_name);
      const pipeIds = new Set((pipes || []).map(p => p.id));
      const match = stages.find(s => pipeIds.has(s.pipeline_id));
      if (match) return match;
    }
    return stages[0];
  }
  return null;
}

// ─── GET /v1/fields — o agente descobre quais campos existem ───
export async function handleFields(req, res, companyId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = adminClient();
  const { data } = await admin.from('custom_fields')
    .select('id, name, type, options').eq('company_id', companyId).order('created_at');

  return res.status(200).json({ fields: data || [] });
}

// ─── GET /v1/contacts — lê o contato (contexto pro agente) ───
//     ?phone= | ?external_id= | ?id=
// ─── PATCH /v1/contacts — escreve dados, campos personalizados, tags e etapa ───
export async function handleContacts(req, res, companyId) {
  const admin = adminClient();

  if (req.method === 'GET') {
    const contact = await resolveContact(companyId, {
      contact_id: req.query?.id,
      external_id: req.query?.external_id,
      phone: req.query?.phone,
    });
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const { data: defs } = await admin.from('custom_fields')
      .select('id, name, type').eq('company_id', companyId);

    const { data: leads } = await admin.from('crm_leads')
      .select('id, stage_id, pipeline_id').eq('contact_id', contact.id).limit(1);

    const { data: conv } = await admin.from('conversations')
      .select('id, state, state_since')
      .eq('company_id', companyId)
      .eq('remote_jid', `${digits(contact.phone)}@s.whatsapp.net`)
      .single();

    return res.status(200).json({
      contact: {
        id: contact.id,
        external_id: contact.external_id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        tags: contact.tags || [],
        fields: fieldsByName(defs || [], contact.fields),
      },
      lead: leads?.[0] || null,
      conversation: conv || null,
    });
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    const { contact_id, external_id, phone, name, email, tags, fields, stage_id, stage_name, pipeline_name } = req.body || {};

    const contact = await resolveContact(companyId, { contact_id, external_id, phone });
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const patch = {};
    if (name !== undefined)  patch.name = name;
    if (email !== undefined) patch.email = email;
    if (tags !== undefined)  patch.tags = Array.isArray(tags) ? tags : [tags];

    let unknownFields = [];
    if (fields && typeof fields === 'object') {
      const { resolved, unknown } = await resolveFieldKeys(companyId, fields);
      unknownFields = unknown;
      // merge: não apaga o que já estava lá
      patch.fields = { ...(contact.fields || {}), ...resolved };
    }

    if (Object.keys(patch).length) {
      await admin.from('crm_contacts').update(patch).eq('id', contact.id).eq('company_id', companyId);
    }

    // Mover de etapa (e de funil, se a etapa for de outro funil)
    let movedTo = null;
    if (stage_id || stage_name) {
      const stage = await resolveStage(companyId, { stage_id, stage_name, pipeline_name });
      if (!stage) return res.status(400).json({ error: 'stage_not_found' });

      const { data: leads } = await admin.from('crm_leads')
        .select('id').eq('contact_id', contact.id).limit(1);

      if (leads?.length) {
        await admin.from('crm_leads')
          .update({ stage_id: stage.id, pipeline_id: stage.pipeline_id })
          .eq('id', leads[0].id);
        movedTo = { lead_id: leads[0].id, stage_id: stage.id, pipeline_id: stage.pipeline_id };
      } else {
        const { data: l } = await admin.from('crm_leads')
          .insert({ company_id: companyId, contact_id: contact.id, stage_id: stage.id, pipeline_id: stage.pipeline_id })
          .select().single();
        movedTo = { lead_id: l?.id, stage_id: stage.id, pipeline_id: stage.pipeline_id };
      }

      await dispatchWebhook(companyId, 'lead.moved', {
        contact_id: contact.id, ...movedTo, source: 'api',
      });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contact.id,
      moved: movedTo,
      unknown_fields: unknownFields, // avisa se o agente mandou um campo que não existe
    });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}

// ─── POST /v1/notes — o agente registra o que fez ───
export async function handleNotes(req, res, companyId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { contact_id, external_id, phone, text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'missing_text' });

  const contact = await resolveContact(companyId, { contact_id, external_id, phone });
  if (!contact) return res.status(404).json({ error: 'contact_not_found' });

  const admin = adminClient();
  const { data } = await admin.from('crm_notes')
    .insert({ company_id: companyId, contact_id: contact.id, text, auto: true })
    .select().single();

  return res.status(200).json({ ok: true, note_id: data?.id, contact_id: contact.id });
}

// ─── /v1/messages ───
//   POST → envia (sender = automation; 409 se a conversa está em human)
//   GET  → histórico da conversa (contexto pro agente)
export async function handleMessages(req, res, companyId) {
  const admin = adminClient();

  // GET /v1/messages?phone=...&limit=50 → histórico
  if (req.method === 'GET') {
    const phone = req.query?.phone;
    if (!phone) return res.status(400).json({ error: 'missing_phone' });
    const limit = Math.min(Number(req.query?.limit) || 50, 200);

    const jid = `${digits(phone)}@s.whatsapp.net`;
    const { data: conv } = await admin.from('conversations')
      .select('id, state, state_since').eq('company_id', companyId).eq('remote_jid', jid).single();

    const { data: msgs } = await admin.from('whatsapp_messages')
      .select('content, from_me, sender, timestamp, message_type, media_url, message_id')
      .eq('company_id', companyId).eq('remote_jid', jid)
      .order('timestamp', { ascending: false }).limit(limit);

    return res.status(200).json({
      conversation: conv || { state: 'automation' },
      messages: (msgs || []).reverse(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { to, content, media } = req.body || {};
  if (!to) return res.status(400).json({ error: 'missing_to' });
  if (!content && !media) return res.status(400).json({ error: 'missing_content' });

  const result = await sendMessage({
    companyId, to, content, media: media || null, sender: 'automation',
  });

  if (result.error) {
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

// ─── POST /v1/leads — idempotente por external_id ───
export async function handleLeads(req, res, companyId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { external_id, name, phone, email, stage_id, pipeline_name, fields } = req.body || {};
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const admin = adminClient();

  // Campos personalizados já na criação (aceita id ou nome)
  let fieldsJson = null;
  let unknownFields = [];
  if (fields && typeof fields === 'object') {
    const { resolved, unknown } = await resolveFieldKeys(companyId, fields);
    fieldsJson = resolved;
    unknownFields = unknown;
  }

  // ─── Idempotência ───
  if (external_id) {
    const { data: existing } = await admin
      .from('crm_contacts').select('id, fields')
      .eq('company_id', companyId).eq('external_id', external_id).single();

    if (existing) {
      const upd = { name, phone: phone || null, email: email || null };
      if (fieldsJson) upd.fields = { ...(existing.fields || {}), ...fieldsJson };
      await admin.from('crm_contacts').update(upd).eq('id', existing.id);

      const { data: lead } = await admin
        .from('crm_leads').select('id').eq('contact_id', existing.id).limit(1);

      return res.status(200).json({
        ok: true, created: false,
        contact_id: existing.id,
        lead_id: lead?.[0]?.id || null,
        unknown_fields: unknownFields,
      });
    }
  }

  const { data: contact, error: cErr } = await admin.from('crm_contacts')
    .insert({
      company_id: companyId, name,
      phone: phone || null, email: email || null,
      external_id: external_id || null,
      fields: fieldsJson || {},
    })
    .select().single();
  if (cErr) return res.status(400).json({ error: cErr.message });

  // Resolve etapa/funil
  let targetStageId = stage_id || null;
  let pipelineId = null;

  if (targetStageId) {
    const { data: st } = await admin.from('crm_stages').select('pipeline_id').eq('id', targetStageId).single();
    pipelineId = st?.pipeline_id || null;
  } else {
    let q = admin.from('crm_pipelines').select('id').eq('company_id', companyId).order('position').limit(1);
    if (pipeline_name) {
      q = admin.from('crm_pipelines').select('id').eq('company_id', companyId).ilike('name', pipeline_name).limit(1);
    }
    const { data: pipes } = await q;
    pipelineId = pipes?.[0]?.id || null;
    if (pipelineId) {
      const { data: st } = await admin.from('crm_stages')
        .select('id').eq('pipeline_id', pipelineId).order('position').limit(1);
      targetStageId = st?.[0]?.id || null;
    }
  }

  let lead = null;
  if (targetStageId) {
    const { data: l } = await admin.from('crm_leads')
      .insert({ company_id: companyId, contact_id: contact.id, stage_id: targetStageId, pipeline_id: pipelineId })
      .select().single();
    lead = l;
  }

  await dispatchWebhook(companyId, 'lead.created', {
    contact_id: contact.id, lead_id: lead?.id || null, source: 'api',
  });

  return res.status(200).json({
    ok: true, created: true,
    contact_id: contact.id,
    lead_id: lead?.id || null,
    unknown_fields: unknownFields,
  });
}
