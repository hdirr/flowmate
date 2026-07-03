import { createClient } from '@supabase/supabase-js';

// Endpoint público para plataformas externas (n8n, Zapier, formulários) criarem
// um contato + lead no FlowMate usando a API key da empresa.
//
// POST /api/public/lead
//   Header:  x-api-key: <chave da empresa>   (ou ?key= na query)
//   Body JSON: { name, phone?, email?, stage_id?, pipeline_name?, source? }
export default async function handler(req, res) {
  // CORS liberado (é uma API pública de entrada)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'] || req.query?.key;
  if (!apiKey) return res.status(401).json({ error: 'API key ausente (header x-api-key)' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: integ } = await admin
    .from('company_integrations')
    .select('company_id, enabled')
    .eq('api_key', apiKey)
    .single();

  if (!integ || integ.enabled === false) return res.status(403).json({ error: 'API key inválida' });
  const companyId = integ.company_id;

  const { name, phone, email, stage_id, pipeline_name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Campo "name" é obrigatório' });

  // Cria o contato
  const { data: contact, error: cErr } = await admin.from('crm_contacts')
    .insert({ company_id: companyId, name, phone: phone || null, email: email || null })
    .select().single();
  if (cErr) return res.status(400).json({ error: cErr.message });

  // Descobre a etapa de destino
  let targetStageId = stage_id || null;
  let pipelineId = null;
  if (!targetStageId) {
    // Se veio nome do funil, usa a 1ª etapa dele; senão, a 1ª etapa do 1º funil
    let pipeQuery = admin.from('crm_pipelines').select('id').eq('company_id', companyId).order('position').limit(1);
    if (pipeline_name) pipeQuery = admin.from('crm_pipelines').select('id').eq('company_id', companyId).eq('name', pipeline_name).limit(1);
    const { data: pipes } = await pipeQuery;
    pipelineId = pipes?.[0]?.id || null;
    if (pipelineId) {
      const { data: st } = await admin.from('crm_stages').select('id, pipeline_id').eq('pipeline_id', pipelineId).order('position').limit(1);
      targetStageId = st?.[0]?.id || null;
    }
  } else {
    const { data: st } = await admin.from('crm_stages').select('pipeline_id').eq('id', targetStageId).single();
    pipelineId = st?.pipeline_id || null;
  }

  let lead = null;
  if (targetStageId) {
    const { data: l } = await admin.from('crm_leads')
      .insert({ company_id: companyId, contact_id: contact.id, stage_id: targetStageId, pipeline_id: pipelineId })
      .select().single();
    lead = l;
  }

  return res.status(200).json({ ok: true, contact_id: contact.id, lead_id: lead?.id || null });
}
