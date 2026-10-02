import { adminClient } from '../db.js';
import { handleContacts, fieldsByName } from '../v1handlers.js';
import { dispatchWebhook } from '../webhooks.js';
import { V1Error, fail, readPaging, paged, readDate, queryParam, isRangeBeyondEnd, isUuid } from './http.js';

// GET /v1/contacts com phone, id ou external_id é a rota ANTIGA (devolve um contato só) e
// segue intacta. A presença da chave na query decide, do jeito que o handler antigo lê
// (mesmo vazia: ?phone= continua respondendo 404 contact_not_found como sempre).
const LEGACY_KEYS = ['phone', 'id', 'external_id'];

// Escapa curinga do LIKE/ILIKE (\ % _) e o * (o PostgREST trata * como %).
function likeEscape(s) {
  return String(s).replace(/[\\%_*]/g, ch => '\\' + ch);
}

// POST /v1/contacts/{id}/tags — adiciona, remove ou substitui tags (nomes da Helena).
// tags: lista de textos (sem duplicatas; espaços das pontas removidos; até 50 por chamada,
// 100 caracteres cada). Comparação exata, como o filtro tag do GET /v1/contacts.
// Resposta 200 { ok, contact_id, tags, added, removed }. Evento contact.tags_updated só se
// mudou algo. Automações da tela (tag_added) não disparam pela API.
const TAG_OPS = ['InsertIfNotExists', 'DeleteIfExists', 'ReplaceAll'];

export async function updateContactTags(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'contact_not_found', 'Contato não encontrado.');
  if (!isUuid(params.id)) return notFound();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const operation = body.operation === undefined ? 'InsertIfNotExists' : body.operation;
  if (!TAG_OPS.includes(operation)) {
    throw new V1Error(400, 'invalid_operation', `"operation" aceita: ${TAG_OPS.join(', ')}.`);
  }
  const raw = body.tags;
  if (!Array.isArray(raw) || raw.length > 50 || (raw.length === 0 && operation !== 'ReplaceAll')
      || raw.some(t => typeof t !== 'string' || !t.trim() || t.trim().length > 100)) {
    throw new V1Error(400, 'invalid_tags', '"tags" precisa ser uma lista de 1 a 50 textos (até 100 caracteres cada); vazia só com ReplaceAll.');
  }
  const input = [...new Set(raw.map(t => t.trim()))];

  const admin = adminClient();
  try {
    const { data: c, error } = await admin.from('crm_contacts')
      .select('id, tags').eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!c) return notFound();

    const cur = c.tags || [];
    let next;
    if (operation === 'InsertIfNotExists') next = [...cur, ...input.filter(t => !cur.includes(t))];
    else if (operation === 'DeleteIfExists') next = cur.filter(t => !input.includes(t));
    else next = input;
    const added = next.filter(t => !cur.includes(t));
    const removed = cur.filter(t => !next.includes(t));

    if (added.length || removed.length) {
      const { error: uErr } = await admin.from('crm_contacts').update({ tags: next })
        .eq('company_id', companyId).eq('id', c.id);
      if (uErr) throw uErr;
      try {
        await dispatchWebhook(companyId, 'contact.tags_updated', {
          contact_id: c.id, tags: next, added, removed, source: 'api',
        });
      } catch (e) { console.error('[v1] webhook de tags falhou:', e?.message || e); }
    }
    return res.status(200).json({ ok: true, contact_id: c.id, tags: added.length || removed.length ? next : cur, added, removed });
  } catch (e) {
    console.error('[v1] tags falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao alterar as tags.');
  }
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
        .select('id, external_id, name, phone, email, tags, fields, metadata, created_at, updated_at', { count: 'exact' })
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

    // Objeto Contato do contrato.
    const items = (data || []).map(c => ({
      id: c.id,
      external_id: c.external_id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      tags: c.tags || [],
      fields: fieldsByName(defs || [], c.fields),
      metadata: c.metadata || {},
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
    return paged(res, page, items, count);
  } catch (e) {
    console.error('[v1] contacts falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar os contatos.');
  }
}
