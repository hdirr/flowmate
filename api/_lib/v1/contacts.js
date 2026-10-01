import { adminClient } from '../db.js';
import { handleContacts, fieldsByName } from '../v1handlers.js';
import { fail, readPaging, paged, readDate, queryParam, isRangeBeyondEnd } from './http.js';

// GET /v1/contacts com phone, id ou external_id é a rota ANTIGA (devolve um contato só) e
// segue intacta. A presença da chave na query decide, do jeito que o handler antigo lê
// (mesmo vazia: ?phone= continua respondendo 404 contact_not_found como sempre).
const LEGACY_KEYS = ['phone', 'id', 'external_id'];

// Escapa curinga do LIKE/ILIKE (\ % _) e o * (o PostgREST trata * como %).
function likeEscape(s) {
  return String(s).replace(/[\\%_*]/g, ch => '\\' + ch);
}

// GET /v1/contacts — lista paginada de Contato. Filtros: name (contém, sem caixa), tag,
// createdAfter/Before, updatedAfter/Before. Ordem created_at desc, id desc.
export async function listContacts(req, res, ctx) {
  const q = req.query || {};
  if (LEGACY_KEYS.some(k => Object.prototype.hasOwnProperty.call(q, k))) {
    return handleContacts(req, res, ctx.companyId);
  }
  const { companyId } = ctx;
  const page = readPaging(q);
  const name = queryParam(q, 'name');
  const tag = queryParam(q, 'tag');
  const f = {
    name: name !== undefined && name !== '' ? String(name) : null,
    tag: tag !== undefined && tag !== '' ? String(tag) : null,
    createdAfter: readDate(q, 'createdAfter'),
    createdBefore: readDate(q, 'createdBefore'),
    updatedAfter: readDate(q, 'updatedAfter'),
    updatedBefore: readDate(q, 'updatedBefore'),
  };

  const admin = adminClient();
  const applyFilters = (query) => {
    query = query.eq('company_id', companyId);
    if (f.name) query = query.ilike('name', `%${likeEscape(f.name)}%`);
    if (f.tag) query = query.contains('tags', [f.tag]);
    if (f.createdAfter) query = query.gte('created_at', f.createdAfter);
    if (f.createdBefore) query = query.lte('created_at', f.createdBefore);
    if (f.updatedAfter) query = query.gte('updated_at', f.updatedAfter);
    if (f.updatedBefore) query = query.lte('updated_at', f.updatedBefore);
    return query;
  };

  try {
    const { data, count, error } = await applyFilters(
      admin.from('crm_contacts')
        .select('id, external_id, name, phone, email, tags, fields, created_at, updated_at', { count: 'exact' })
    )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(error)) {
      const { count: total, error: cErr } = await applyFilters(
        admin.from('crm_contacts').select('id', { count: 'exact', head: true })
      );
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (error) throw error;

    // custom_fields uma vez por requisição (não por contato)
    const { data: defs, error: dErr } = await admin.from('custom_fields')
      .select('id, name').eq('company_id', companyId);
    if (dErr) throw dErr;

    // Objeto Contato do contrato. metadata entra depois da P1-E1.
    const items = (data || []).map(c => ({
      id: c.id,
      external_id: c.external_id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      tags: c.tags || [],
      fields: fieldsByName(defs || [], c.fields),
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
    return paged(res, page, items, count);
  } catch (e) {
    console.error('[v1] contacts falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar os contatos.');
  }
}
