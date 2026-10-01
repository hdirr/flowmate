import { adminClient } from '../db.js';
import { fail, readPaging, paged, isRangeBeyondEnd } from './http.js';

// GET /v1/pipelines — funis da empresa com as etapas de cada um (objeto Funil do contrato).
// Equivale ao GET /crm/v2/panel da Helena. allowed_users e company_id não saem na resposta.
export async function listPipelines(req, res, { companyId }) {
  const admin = adminClient();
  const page = readPaging(req.query);

  const { data: pipes, count, error } = await admin.from('crm_pipelines')
    .select('id, name, position', { count: 'exact' })
    .eq('company_id', companyId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })
    .range(page.from, page.to);
  if (isRangeBeyondEnd(error)) {
    // Página além do fim: só o total, items vazio.
    const { count: total, error: cErr } = await admin.from('crm_pipelines')
      .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
    if (cErr) return internal(res, cErr);
    return paged(res, page, [], total);
  }
  if (error) return internal(res, error);

  const ids = (pipes || []).map(p => p.id);
  let stages = [];
  if (ids.length) {
    // company_id também aqui: há etapas com company_id nulo no banco que não podem aparecer.
    const { data, error: stErr } = await admin.from('crm_stages')
      .select('id, name, color, position, pipeline_id')
      .eq('company_id', companyId)
      .in('pipeline_id', ids)
      .order('position', { ascending: true });
    if (stErr) return internal(res, stErr);
    stages = data || [];
  }

  const items = (pipes || []).map(p => ({
    id: p.id,
    name: p.name,
    position: p.position,
    stages: stages
      .filter(s => s.pipeline_id === p.id)
      .map(s => ({ id: s.id, name: s.name, color: s.color, position: s.position })),
  }));

  return paged(res, page, items, count);
}

function internal(res, error) {
  console.error('[v1] pipelines falhou:', error.message);
  return fail(res, 500, 'internal_error', 'Erro ao consultar os funis.');
}
