import { adminClient, resolveApiKey } from '../_lib/db.js';

/**
 * POST /v1/leads — idempotente por external_id.
 *
 * Header: x-api-key: <api key do tenant>
 * Body:   { external_id, name, phone?, email?, stage_id?, pipeline_name? }
 *
 * Upsert por (company_id, external_id). Sem isso: o n8n re-executa o workflow em erro
 * e o mesmo lead vira 3 contatos e 3 "olá" no WhatsApp da pessoa.
 *
 * Sem external_id, cai no comportamento antigo (cria sempre) — o /api/public/lead
 * continua existindo e não foi tocado.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const apiKey = req.headers['x-api-key'] || req.query?.key;
  const companyId = await resolveApiKey(apiKey);
  if (!companyId) return res.status(401).json({ error: 'invalid_api_key' });

  const { external_id, name, phone, email, stage_id, pipeline_name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const admin = adminClient();

  // ─── Idempotência ───
  if (external_id) {
    const { data: existing } = await admin
      .from('crm_contacts')
      .select('id')
      .eq('company_id', companyId)
      .eq('external_id', external_id)
      .single();

    if (existing) {
      // Já existe: atualiza os dados e devolve o mesmo id. Nenhum lead novo, nenhum "olá" duplicado.
      await admin.from('crm_contacts')
        .update({ name, phone: phone || null, email: email || null })
        .eq('id', existing.id);

      const { data: lead } = await admin
        .from('crm_leads').select('id').eq('contact_id', existing.id).limit(1);

      return res.status(200).json({
        ok: true,
        created: false,
        contact_id: existing.id,
        lead_id: lead?.[0]?.id || null,
      });
    }
  }

  // ─── Cria o contato ───
  const { data: contact, error: cErr } = await admin.from('crm_contacts')
    .insert({
      company_id: companyId,
      name,
      phone: phone || null,
      email: email || null,
      external_id: external_id || null,
    })
    .select().single();
  if (cErr) return res.status(400).json({ error: cErr.message });

  // ─── Resolve etapa/funil de destino ───
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
    ok: true,
    created: true,
    contact_id: contact.id,
    lead_id: lead?.id || null,
  });
}
