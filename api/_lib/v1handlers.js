import { adminClient } from './db.js';
import { sendMessage } from './sendMessage.js';

/**
 * POST /v1/messages — a boca do n8n.
 * Body: { to, content, media?: { url, type, mimeType?, fileName? } }
 * Sempre sender = 'automation'. Conversa em 'human' → 409 conversation_paused.
 * O consumidor não precisa checar estado: a pausa é imposta aqui, no ponto de saída.
 */
export async function handleMessages(req, res, companyId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

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

/**
 * POST /v1/leads — idempotente por external_id.
 * Body: { external_id, name, phone?, email?, stage_id?, pipeline_name? }
 * Upsert por (company_id, external_id): o n8n re-executando o workflow não vira
 * 3 contatos e 3 "olá" no WhatsApp da pessoa.
 */
export async function handleLeads(req, res, companyId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { external_id, name, phone, email, stage_id, pipeline_name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const admin = adminClient();

  // ─── Idempotência ───
  if (external_id) {
    const { data: existing } = await admin
      .from('crm_contacts').select('id')
      .eq('company_id', companyId).eq('external_id', external_id).single();

    if (existing) {
      await admin.from('crm_contacts')
        .update({ name, phone: phone || null, email: email || null })
        .eq('id', existing.id);

      const { data: lead } = await admin
        .from('crm_leads').select('id').eq('contact_id', existing.id).limit(1);

      return res.status(200).json({
        ok: true, created: false,
        contact_id: existing.id,
        lead_id: lead?.[0]?.id || null,
      });
    }
  }

  const { data: contact, error: cErr } = await admin.from('crm_contacts')
    .insert({
      company_id: companyId, name,
      phone: phone || null, email: email || null,
      external_id: external_id || null,
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
      q = admin.from('crm_pipelines').select('id').eq('company_id', companyId).eq('name', pipeline_name).limit(1);
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

  return res.status(200).json({
    ok: true, created: true,
    contact_id: contact.id,
    lead_id: lead?.id || null,
  });
}
