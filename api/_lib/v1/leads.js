import { adminClient } from '../db.js';
import { fieldsByName } from '../v1handlers.js';
import { V1Error, fail, readPaging, paged, readDate, isUuid, queryParam, isRangeBeyondEnd } from './http.js';

const LEAD_COLS = 'id, contact_id, pipeline_id, stage_id, value, priority, created_at, updated_at, '
  + 'contact:crm_contacts(id, name, phone, email, tags)';

// No GET /v1/leads/{id} o contato vem completo (objeto Contato do contrato).
const LEAD_FULL_COLS = 'id, contact_id, pipeline_id, stage_id, value, priority, created_at, updated_at, '
  + 'contact:crm_contacts(id, external_id, name, phone, email, tags, fields, created_at, updated_at)';

// Filtros de id: UUID inválido é erro do cliente (400), não "lista vazia".
function readUuidFilter(query, name) {
  const v = queryParam(query, name);
  if (v === undefined || v === '') return null;
  if (!isUuid(String(v))) throw new V1Error(400, 'invalid_filter', `"${name}" precisa ser um UUID.`);
  return String(v);
}

function readBoolFilter(query, name) {
  const v = queryParam(query, name);
  if (v === undefined || v === '') return null;
  const s = String(v).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  throw new V1Error(400, 'invalid_filter', `"${name}" aceita só true ou false.`);
}

// Nomes de funil e etapa, carregados uma vez por requisição. As etapas vêm pelos funis da
// empresa (pipeline_id), não por crm_stages.company_id: há etapas com company_id nulo.
async function loadNames(admin, companyId) {
  const { data: pipes, error } = await admin.from('crm_pipelines')
    .select('id, name').eq('company_id', companyId);
  if (error) throw error;
  const pipelineNames = new Map((pipes || []).map(p => [p.id, p.name]));
  const stageNames = new Map();
  if (pipelineNames.size) {
    const { data: stages, error: stErr } = await admin.from('crm_stages')
      .select('id, name').in('pipeline_id', [...pipelineNames.keys()]);
    if (stErr) throw stErr;
    for (const s of stages || []) stageNames.set(s.id, s.name);
  }
  return { pipelineNames, stageNames };
}

// Objeto Lead do contrato (20-contrato-api-v1.md). metadata entra depois da P1-E1.
function toLead(l, names) {
  const c = l.contact;
  return {
    id: l.id,
    contact_id: l.contact_id,
    pipeline_id: l.pipeline_id,
    pipeline_name: names.pipelineNames.get(l.pipeline_id) ?? null,
    stage_id: l.stage_id,
    stage_name: names.stageNames.get(l.stage_id) ?? null,
    // crm_leads.value é numeric: sai como número (ou null), nunca texto
    value: l.value === null || l.value === undefined ? null : Number(l.value),
    priority: l.priority,
    created_at: l.created_at,
    updated_at: l.updated_at,
    // contact_id órfão (contato apagado) ou ausente → null, sem quebrar a lista
    contact: c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, tags: c.tags || [] } : null,
  };
}

// GET /v1/leads/{id} — um Lead com o contato completo (objeto Contato, fields por nome).
// Id que não é UUID ou de outra empresa → 404 lead_not_found (nunca 500, nunca 403).
export async function getLead(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'lead_not_found', 'Lead não encontrado.');
  if (!isUuid(params.id)) return notFound();

  const admin = adminClient();
  try {
    const { data: l, error } = await admin.from('crm_leads')
      .select(LEAD_FULL_COLS)
      .eq('company_id', companyId).eq('id', params.id)
      .maybeSingle();
    if (error) throw error;
    if (!l) return notFound();

    const names = await loadNames(admin, companyId);
    const lead = toLead(l, names);

    if (l.contact) {
      const { data: defs, error: dErr } = await admin.from('custom_fields')
        .select('id, name').eq('company_id', companyId);
      if (dErr) throw dErr;
      const c = l.contact;
      // Objeto Contato do contrato. metadata entra depois da P1-E1.
      lead.contact = {
        id: c.id,
        external_id: c.external_id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        tags: c.tags || [],
        fields: fieldsByName(defs || [], c.fields),
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
    }
    return res.status(200).json(lead);
  } catch (e) {
    console.error('[v1] lead falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar o lead.');
  }
}

// GET /v1/leads — lista paginada de Lead. Filtros: pipelineId, stageId, contactId, priority,
// createdAfter/Before, updatedAfter/Before. Ordem created_at desc, id desc (estável).
export async function listLeads(req, res, { companyId }) {
  const q = req.query || {};
  const page = readPaging(q);
  const f = {
    pipelineId: readUuidFilter(q, 'pipelineId'),
    stageId: readUuidFilter(q, 'stageId'),
    contactId: readUuidFilter(q, 'contactId'),
    priority: readBoolFilter(q, 'priority'),
    createdAfter: readDate(q, 'createdAfter'),
    createdBefore: readDate(q, 'createdBefore'),
    updatedAfter: readDate(q, 'updatedAfter'),
    updatedBefore: readDate(q, 'updatedBefore'),
  };

  const admin = adminClient();
  const applyFilters = (query) => {
    query = query.eq('company_id', companyId);
    if (f.pipelineId) query = query.eq('pipeline_id', f.pipelineId);
    if (f.stageId) query = query.eq('stage_id', f.stageId);
    if (f.contactId) query = query.eq('contact_id', f.contactId);
    if (f.priority !== null) query = query.eq('priority', f.priority);
    if (f.createdAfter) query = query.gte('created_at', f.createdAfter);
    if (f.createdBefore) query = query.lte('created_at', f.createdBefore);
    if (f.updatedAfter) query = query.gte('updated_at', f.updatedAfter);
    if (f.updatedBefore) query = query.lte('updated_at', f.updatedBefore);
    return query;
  };

  try {
    const { data, count, error } = await applyFilters(
      admin.from('crm_leads').select(LEAD_COLS, { count: 'exact' })
    )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(error)) {
      const { count: total, error: cErr } = await applyFilters(
        admin.from('crm_leads').select('id', { count: 'exact', head: true })
      );
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (error) throw error;

    const names = await loadNames(admin, companyId);
    return paged(res, page, (data || []).map(l => toLead(l, names)), count);
  } catch (e) {
    console.error('[v1] leads falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar os leads.');
  }
}
