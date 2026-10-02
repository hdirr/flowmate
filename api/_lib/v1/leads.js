import { adminClient } from '../db.js';
import { fieldsByName } from '../v1handlers.js';
import { dispatchWebhook } from '../webhooks.js';
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

// ─── Escrita ─────────────────────────────────────────────────

// Erro de corpo das rotas de escrita: 400 com o nome do campo na mensagem.
const badField = (name, msg) => new V1Error(400, 'invalid_field', `"${name}": ${msg}`);

// ilike exato (sem curinga do usuário): escapa \ % _ e o * do PostgREST.
const likeExact = s => String(s).replace(/[\\%_*]/g, ch => '\\' + ch);

// Etapa de destino por stage_id ou stage_name (+ pipeline_name), sempre dentro dos funis da
// empresa (pelo pipeline_id, como o GET /v1/leads — não por crm_stages.company_id).
// Nome repetido em vários funis sem pipeline_name: prefere o funil atual do lead.
async function resolveTargetStage(admin, companyId, body, currentPipelineId) {
  let pipesQ = admin.from('crm_pipelines').select('id').eq('company_id', companyId);
  if (body.pipeline_name !== undefined) {
    if (typeof body.pipeline_name !== 'string' || !body.pipeline_name.trim()) throw badField('pipeline_name', 'texto obrigatório');
    pipesQ = pipesQ.ilike('name', likeExact(body.pipeline_name.trim()));
  }
  const { data: pipes, error } = await pipesQ;
  if (error) throw error;
  const pipeIds = (pipes || []).map(p => p.id);
  if (!pipeIds.length) return null;

  let q = admin.from('crm_stages').select('id, pipeline_id').in('pipeline_id', pipeIds);
  if (body.stage_id !== undefined) {
    if (!isUuid(String(body.stage_id))) return null;
    q = q.eq('id', body.stage_id);
  } else {
    if (typeof body.stage_name !== 'string' || !body.stage_name.trim()) throw badField('stage_name', 'texto obrigatório');
    q = q.ilike('name', likeExact(body.stage_name.trim()));
  }
  const { data: stages, error: sErr } = await q.order('position', { ascending: true });
  if (sErr) throw sErr;
  if (!stages?.length) return null;
  return stages.find(s => s.pipeline_id === currentPipelineId) || stages[0];
}

// PATCH /v1/leads/{id} — move de etapa/funil, prioridade e valor. Campos personalizados são do
// contato (PATCH /v1/contacts); metadata só depois da P1-E1. Resposta: o Lead (como o GET).
// Eventos: lead.moved (se a etapa mudou, payload igual ao de hoje) e lead.updated (se algo mudou).
export async function updateLead(req, res, ctx) {
  const { companyId, params } = ctx;
  const notFound = () => fail(res, 404, 'lead_not_found', 'Lead não encontrado.');
  if (!isUuid(params.id)) return notFound();

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  if (body.metadata !== undefined) throw badField('metadata', 'ainda não disponível (depende da P1-E1)');
  const wantsStage = body.stage_id !== undefined || body.stage_name !== undefined;
  if (!wantsStage && body.pipeline_name !== undefined) throw badField('pipeline_name', 'use junto com stage_name');
  if (body.priority !== undefined && typeof body.priority !== 'boolean') throw badField('priority', 'use true ou false');
  if (body.value !== undefined && body.value !== null
      && !(typeof body.value === 'number' && Number.isFinite(body.value) && body.value >= 0 && body.value < 1e12)) {
    throw badField('value', 'número maior ou igual a 0, ou null');
  }
  if (!wantsStage && body.priority === undefined && body.value === undefined) {
    throw new V1Error(400, 'empty_update', 'Nada para alterar. Campos aceitos: stage_id, stage_name, pipeline_name, priority, value.');
  }

  const admin = adminClient();
  try {
    const { data: lead, error } = await admin.from('crm_leads')
      .select('id, contact_id, pipeline_id, stage_id, priority, value')
      .eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!lead) return notFound();

    const patch = {};
    const changes = [];
    if (wantsStage) {
      const stage = await resolveTargetStage(admin, companyId, body, lead.pipeline_id);
      if (!stage) return fail(res, 400, 'stage_not_found', 'Etapa não encontrada nos funis da empresa.');
      if (stage.id !== lead.stage_id) { patch.stage_id = stage.id; changes.push('stage_id'); }
      if (stage.pipeline_id !== lead.pipeline_id) { patch.pipeline_id = stage.pipeline_id; changes.push('pipeline_id'); }
    }
    if (body.priority !== undefined && body.priority !== lead.priority) { patch.priority = body.priority; changes.push('priority'); }
    if (body.value !== undefined) {
      const cur = lead.value === null || lead.value === undefined ? null : Number(lead.value);
      if (body.value !== cur) { patch.value = body.value; changes.push('value'); }
    }

    if (changes.length) {
      const { error: uErr } = await admin.from('crm_leads').update(patch)
        .eq('company_id', companyId).eq('id', lead.id);
      if (uErr) throw uErr;
      const after = { ...lead, ...patch };
      // Webhook do cliente nunca derruba a ação principal.
      try {
        if (patch.stage_id || patch.pipeline_id) {
          await dispatchWebhook(companyId, 'lead.moved', {
            contact_id: lead.contact_id, lead_id: lead.id, stage_id: after.stage_id, pipeline_id: after.pipeline_id, source: 'api',
          });
        }
        await dispatchWebhook(companyId, 'lead.updated', {
          lead_id: lead.id, contact_id: lead.contact_id, stage_id: after.stage_id, pipeline_id: after.pipeline_id,
          priority: after.priority, value: after.value === null ? null : Number(after.value), changes, source: 'api',
        });
      } catch (e) { console.error('[v1] webhook de lead falhou:', e?.message || e); }
    }
  } catch (e) {
    console.error('[v1] update lead falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao alterar o lead.');
  }
  return getLead(req, res, ctx);
}

// POST /v1/leads/{id}/notes — cria nota no CONTATO do lead (as notas são do contato).
// { text, user_id? }: text obrigatório (até 8000); user_id opcional = autor, precisa ser usuário
// da mesma empresa. auto: false quando há autor (user_id); sem autor, auto: true (como o
// POST /v1/notes antigo). 201 com a Nota.
// Evento note.created. Lead sem contato → 422 lead_without_contact.
export async function createLeadNote(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'lead_not_found', 'Lead não encontrado.');
  if (!isUuid(params.id)) return notFound();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new V1Error(400, 'missing_text', '"text" é obrigatório.');
  if (body.text.length > 8000) throw new V1Error(400, 'text_too_long', '"text" aceita até 8000 caracteres.');
  if (body.user_id !== undefined && body.user_id !== null && !isUuid(String(body.user_id))) {
    throw badField('user_id', 'precisa ser o id de um usuário (GET /v1/users)');
  }

  const admin = adminClient();
  try {
    const { data: lead, error } = await admin.from('crm_leads')
      .select('id, contact_id').eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!lead) return notFound();
    if (!lead.contact_id) return fail(res, 422, 'lead_without_contact', 'O lead não tem contato para receber a nota.');

    if (body.user_id) {
      const { data: u, error: uErr } = await admin.from('user_profiles')
        .select('id').eq('company_id', companyId).eq('id', body.user_id).maybeSingle();
      if (uErr) throw uErr;
      if (!u) return fail(res, 400, 'invalid_field', '"user_id": usuário não encontrado nesta empresa.');
    }

    const { data: n, error: iErr } = await admin.from('crm_notes')
      .insert({ company_id: companyId, contact_id: lead.contact_id, text: body.text, auto: !body.user_id, user_id: body.user_id || null })
      .select('id, contact_id, text, auto, user_id, created_at').single();
    if (iErr) throw iErr;

    try {
      await dispatchWebhook(companyId, 'note.created', {
        note_id: n.id, contact_id: n.contact_id, lead_id: lead.id, text: n.text, source: 'api',
      });
    } catch (e) { console.error('[v1] webhook de nota falhou:', e?.message || e); }

    // Objeto Nota do contrato
    return res.status(201).json({ id: n.id, contact_id: n.contact_id, text: n.text, auto: n.auto, user_id: n.user_id, created_at: n.created_at });
  } catch (e) {
    console.error('[v1] create note falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao criar a nota.');
  }
}

// GET /v1/leads/{id}/notes — notas do lead, paginadas, mais recentes primeiro.
// As notas são do CONTATO (crm_notes.contact_id), então lista as do contato do lead.
// Autor: só user_id (sem e-mail; nulo quando veio de automação ou da API).
// Lead sem contato ou sem notas → items: [] com 200. Lead de outra empresa/inexistente → 404.
export async function listLeadNotes(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'lead_not_found', 'Lead não encontrado.');
  if (!isUuid(params.id)) return notFound();
  const page = readPaging(req.query);

  const admin = adminClient();
  try {
    const { data: lead, error } = await admin.from('crm_leads')
      .select('id, contact_id').eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!lead) return notFound();
    if (!lead.contact_id) return paged(res, page, [], 0);

    const scope = (q) => q.eq('company_id', companyId).eq('contact_id', lead.contact_id);
    const { data, count, error: nErr } = await scope(
      admin.from('crm_notes').select('id, contact_id, text, auto, user_id, created_at', { count: 'exact' })
    )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(nErr)) {
      const { count: total, error: cErr } = await scope(
        admin.from('crm_notes').select('id', { count: 'exact', head: true })
      );
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (nErr) throw nErr;

    // Objeto Nota do contrato
    const items = (data || []).map(n => ({
      id: n.id, contact_id: n.contact_id, text: n.text, auto: n.auto, user_id: n.user_id, created_at: n.created_at,
    }));
    return paged(res, page, items, count);
  } catch (e) {
    console.error('[v1] lead notes falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar as notas.');
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
