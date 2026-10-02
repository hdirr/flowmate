import { adminClient } from '../db.js';
import { V1Error, fail, readPaging, paged, readDate, isUuid, queryParam, isRangeBeyondEnd } from './http.js';
import { MESSAGE_COLS, toMessage } from './messages.js';

// Tipo e telefone a partir do JID. Grupo = @g.us. @lid (identificador novo do WhatsApp) não é
// telefone. phone só sai para @s.whatsapp.net; o resto (grupo, @lid, formato desconhecido) → null.
function jidInfo(jid) {
  const s = String(jid || '');
  if (s.endsWith('@g.us')) return { type: 'group', phone: null };
  if (s.endsWith('@s.whatsapp.net')) return { type: 'individual', phone: s.slice(0, s.indexOf('@')).replace(/\D/g, '') || null };
  return { type: 'individual', phone: null };
}

const CONV_COLS = 'id, remote_jid, contact_id, state, state_since, state_by, updated_at';

// conversations não tem FK para crm_contacts: segunda consulta com os contatos das conversas.
async function loadContacts(admin, companyId, convs) {
  const ids = [...new Set(convs.map(c => c.contact_id).filter(Boolean))];
  const contacts = new Map();
  if (ids.length) {
    const { data: cs, error } = await admin.from('crm_contacts')
      .select('id, name').eq('company_id', companyId).in('id', ids);
    if (error) throw error;
    for (const c of cs || []) contacts.set(c.id, { id: c.id, name: c.name });
  }
  return contacts;
}

// Objeto Conversa do contrato. Em grupo, phone e contact são null e state é informativo.
function toConversation(c, contacts) {
  const { type, phone } = jidInfo(c.remote_jid);
  return {
    id: c.id,
    type,
    remote_jid: c.remote_jid,
    phone,
    contact_id: c.contact_id,
    state: c.state,
    state_since: c.state_since,
    state_by: c.state_by,
    updated_at: c.updated_at,
    contact: type === 'group' ? null : (contacts.get(c.contact_id) || null),
  };
}

function readEnum(query, name, allowed) {
  const v = queryParam(query, name);
  if (v === undefined || v === '') return null;
  const s = String(v);
  if (!allowed.includes(s)) throw new V1Error(400, 'invalid_filter', `"${name}" aceita só ${allowed.join(' ou ')}.`);
  return s;
}

// GET /v1/conversations/{id} — uma Conversa + last_message (objeto Mensagem ou null).
// A última mensagem é buscada por company_id + remote_jid (não só conversation_id: mensagens
// antigas podem não ter). O FlowMate guarda só 7 dias, então last_message null é comum.
export async function getConversation(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'conversation_not_found', 'Conversa não encontrada.');
  if (!isUuid(params.id)) return notFound();

  const admin = adminClient();
  try {
    const { data: c, error } = await admin.from('conversations')
      .select(CONV_COLS).eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!c) return notFound();

    const [contacts, last] = await Promise.all([
      loadContacts(admin, companyId, [c]),
      admin.from('whatsapp_messages').select(MESSAGE_COLS)
        .eq('company_id', companyId).eq('remote_jid', c.remote_jid)
        .order('timestamp', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1),
    ]);
    if (last.error) throw last.error;

    return res.status(200).json({ ...toConversation(c, contacts), last_message: toMessage(last.data?.[0]) });
  } catch (e) {
    console.error('[v1] conversation falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar a conversa.');
  }
}

// GET /v1/conversations/{id}/messages — lista paginada de Mensagem da conversa.
// Busca por company_id + remote_jid da conversa (como o last_message). Query order: desc (padrão,
// mais novas primeiro) ou asc; outro valor → 400 invalid_filter. Só 7 dias de mensagens no banco.
export async function listConversationMessages(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'conversation_not_found', 'Conversa não encontrada.');
  if (!isUuid(params.id)) return notFound();
  const ascending = (readEnum(req.query || {}, 'order', ['desc', 'asc']) || 'desc') === 'asc';
  const page = readPaging(req.query);

  const admin = adminClient();
  try {
    const { data: c, error } = await admin.from('conversations')
      .select('id, remote_jid').eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!c) return notFound();

    const scope = (q) => q.eq('company_id', companyId).eq('remote_jid', c.remote_jid);
    const { data, count, error: mErr } = await scope(
      admin.from('whatsapp_messages').select(MESSAGE_COLS, { count: 'exact' })
    )
      .order('timestamp', { ascending, nullsFirst: false })
      .order('id', { ascending })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(mErr)) {
      const { count: total, error: cErr } = await scope(
        admin.from('whatsapp_messages').select('id', { count: 'exact', head: true })
      );
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (mErr) throw mErr;
    return paged(res, page, (data || []).map(toMessage), count);
  } catch (e) {
    console.error('[v1] conversation messages falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar as mensagens.');
  }
}

// GET /v1/conversations — lista paginada de Conversa. Filtros: state, type, contactId,
// updatedAfter/Before. Ordem updated_at desc (nulos no fim), id desc.
// Atenção: conversations.updated_at não tem gatilho — é a última mudança de ESTADO, não a
// última mensagem (registrado no contrato).
export async function listConversations(req, res, { companyId }) {
  const q = req.query || {};
  const page = readPaging(q);
  const contactId = queryParam(q, 'contactId');
  if (contactId !== undefined && contactId !== '' && !isUuid(String(contactId))) {
    throw new V1Error(400, 'invalid_filter', '"contactId" precisa ser um UUID.');
  }
  const f = {
    state: readEnum(q, 'state', ['automation', 'human']),
    type: readEnum(q, 'type', ['individual', 'group']),
    contactId: contactId ? String(contactId) : null,
    updatedAfter: readDate(q, 'updatedAfter'),
    updatedBefore: readDate(q, 'updatedBefore'),
  };

  const admin = adminClient();
  const applyFilters = (query) => {
    query = query.eq('company_id', companyId);
    if (f.state) query = query.eq('state', f.state);
    if (f.type === 'group') query = query.like('remote_jid', '%@g.us');
    if (f.type === 'individual') query = query.not('remote_jid', 'like', '%@g.us');
    if (f.contactId) query = query.eq('contact_id', f.contactId);
    if (f.updatedAfter) query = query.gte('updated_at', f.updatedAfter);
    if (f.updatedBefore) query = query.lte('updated_at', f.updatedBefore);
    return query;
  };

  try {
    const { data, count, error } = await applyFilters(
      admin.from('conversations').select(CONV_COLS, { count: 'exact' })
    )
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(error)) {
      const { count: total, error: cErr } = await applyFilters(
        admin.from('conversations').select('id', { count: 'exact', head: true })
      );
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (error) throw error;

    const contacts = await loadContacts(admin, companyId, data || []);
    return paged(res, page, (data || []).map(c => toConversation(c, contacts)), count);
  } catch (e) {
    console.error('[v1] conversations falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar as conversas.');
  }
}
