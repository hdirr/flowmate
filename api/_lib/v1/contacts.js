import { adminClient } from '../db.js';
import { handleContacts, fieldsByName, resolveContact, resolveFieldKeys } from '../v1handlers.js';
import { dispatchWebhook } from '../webhooks.js';
import { V1Error, fail, readPaging, paged, readDate, queryParam, isRangeBeyondEnd, isUuid, isPlainObject, mergeMetadata, sameJson } from './http.js';

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

// ─── POST /v1/contacts (P1-E2) ───────────────────────────────
// Cria um contato (sem lead) ou, se ele já existe, faz EXATAMENTE o que a rota fazia antes
// (POST era apelido não documentado do PATCH /v1/contacts: handleContacts, sem mudança) e
// acrescenta created: false. Existência: a mesma regra do handler antigo (resolveContact):
// contact_id; senão external_id; senão telefone (últimos 8 dígitos). options.upsert === false
// com contato existente → 409 contact_exists, nada alterado. contact_id que não existe → 404
// (como antes: não dá para criar com id escolhido pelo cliente).
// Eventos: contact.created (criou, payload igual ao da tela + source) e contact.updated
// (existia e algo mudou: { contact_id, changes, source }). Não cria lead (POST /v1/leads).
const badField = (name, msg) => new V1Error(400, 'invalid_field', `"${name}": ${msg}`);
const optText = (body, name) => {
  const v = body[name];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw badField(name, 'precisa ser texto');
  return String(v);
};

// Roda o handler antigo e devolve { status, body } em vez de responder direto.
async function runLegacy(body, companyId) {
  const out = { status: 200, body: null };
  const fakeRes = {
    status(code) { out.status = code; return this; },
    json(b) { out.body = b; return this; },
  };
  await handleContacts({ method: 'POST', body, query: {} }, fakeRes, companyId);
  return out;
}

const TRACKED = ['name', 'email', 'tags', 'fields', 'metadata'];

export async function createContact(req, res, { companyId }) {
  const body = isPlainObject(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const options = body.options === undefined || body.options === null ? {} : body.options;
  if (!isPlainObject(options)) throw badField('options', 'precisa ser um objeto');
  if (options.upsert !== undefined && typeof options.upsert !== 'boolean') throw badField('options.upsert', 'use true ou false');
  if (body.metadata !== undefined) mergeMetadata({}, body.metadata); // formato; tamanho no merge
  const contactNotFound = () => fail(res, 404, 'contact_not_found', 'Contato não encontrado.');
  const hasId = body.contact_id !== undefined && body.contact_id !== null && body.contact_id !== '';
  if (hasId && !isUuid(String(body.contact_id))) return contactNotFound();

  const admin = adminClient();
  try {
    const existing = await resolveContact(companyId, {
      contact_id: body.contact_id, external_id: body.external_id, phone: body.phone,
    });

    if (existing) {
      if (options.upsert === false) {
        return res.status(409).json({ error: 'contact_exists', message: 'Já existe um contato com estes dados.', contact_id: existing.id });
      }
      const legacy = await runLegacy(body, companyId);
      if (legacy.status === 200 && body.metadata !== undefined) {
        const merged = mergeMetadata(existing.metadata, body.metadata);
        if (!sameJson(merged, existing.metadata || {})) {
          const { error: mErr } = await admin.from('crm_contacts').update({ metadata: merged })
            .eq('company_id', companyId).eq('id', existing.id);
          if (mErr) throw mErr;
        }
      }
      // O handler antigo pode ter gravado mesmo respondendo erro (ex.: nome antes de
      // stage_not_found): o evento reflete o que mudou de fato no banco.
      const { data: after, error: aErr } = await admin.from('crm_contacts')
        .select(TRACKED.join(', ')).eq('company_id', companyId).eq('id', existing.id).maybeSingle();
      if (aErr) throw aErr;
      const changes = after ? TRACKED.filter(k => !sameJson(after[k] ?? null, existing[k] ?? null)) : [];
      if (changes.length) {
        try {
          await dispatchWebhook(companyId, 'contact.updated', { contact_id: existing.id, changes, source: 'api' });
        } catch (e) { console.error('[v1] webhook de contato falhou:', e?.message || e); }
      }
      if (legacy.status !== 200) return res.status(legacy.status).json(legacy.body);
      return res.status(200).json({ ...legacy.body, created: false });
    }

    if (hasId) return contactNotFound();

    // ── Cria ──
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new V1Error(400, 'missing_name', '"name" é obrigatório para criar o contato.');
    for (const k of ['stage_id', 'stage_name', 'pipeline_name']) {
      if (body[k] !== undefined) throw badField(k, 'contato novo não recebe etapa; use POST /v1/leads');
    }
    const phone = optText(body, 'phone');
    const email = optText(body, 'email');
    const externalId = optText(body, 'external_id');
    // Sem índice único em external_id: se já houver mais de um contato com ele, o .single() do
    // resolveContact devolve nulo. Nesse caso não cria um terceiro: 409, sem escolher um deles.
    if (externalId) {
      const { count, error: dErr } = await admin.from('crm_contacts')
        .select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('external_id', externalId);
      if (dErr) throw dErr;
      if (count) {
        return res.status(409).json({ error: 'contact_exists', message: 'Há mais de um contato com este external_id; use contact_id.', contact_id: null });
      }
    }
    let tags = [];
    if (body.tags !== undefined && body.tags !== null) {
      const raw = body.tags;
      if (!Array.isArray(raw) || raw.length > 50 || raw.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 100)) {
        throw new V1Error(400, 'invalid_tags', '"tags" precisa ser uma lista de até 50 textos (até 100 caracteres cada).');
      }
      tags = [...new Set(raw.map(x => x.trim()))];
    }
    let fields = {};
    let unknownFields = [];
    if (body.fields !== undefined && body.fields !== null) {
      if (!isPlainObject(body.fields)) throw badField('fields', 'precisa ser um objeto { "Nome do campo": valor }');
      const r = await resolveFieldKeys(companyId, body.fields);
      fields = r.resolved;
      unknownFields = r.unknown;
    }
    const metadata = body.metadata === undefined ? {} : mergeMetadata({}, body.metadata);

    // Telefone gravado como veio (igual ao POST /v1/leads). created_by nulo: veio da API.
    const { data: c, error: cErr } = await admin.from('crm_contacts')
      .insert({ company_id: companyId, name, phone, email, external_id: externalId, tags, fields, metadata, created_by: null })
      .select('id, name, phone, email').single();
    if (cErr) throw cErr;

    try {
      await dispatchWebhook(companyId, 'contact.created', {
        contact_id: c.id, name: c.name, phone: c.phone, email: c.email, source: 'api',
      });
    } catch (e) { console.error('[v1] webhook de contato falhou:', e?.message || e); }

    return res.status(201).json({ ok: true, created: true, contact_id: c.id, unknown_fields: unknownFields });
  } catch (e) {
    if (e instanceof V1Error) throw e;
    console.error('[v1] create contact falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao gravar o contato.');
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
