import { adminClient } from '../db.js';
import { V1Error, fail, readPaging, paged, readDate, isUuid, queryParam, isRangeBeyondEnd } from './http.js';

// Tipo e telefone a partir do JID. Grupo = @g.us. @lid (identificador novo do WhatsApp) não é
// telefone. phone só sai para @s.whatsapp.net; o resto (grupo, @lid, formato desconhecido) → null.
function jidInfo(jid) {
  const s = String(jid || '');
  if (s.endsWith('@g.us')) return { type: 'group', phone: null };
  if (s.endsWith('@s.whatsapp.net')) return { type: 'individual', phone: s.slice(0, s.indexOf('@')).replace(/\D/g, '') || null };
  return { type: 'individual', phone: null };
}

function readEnum(query, name, allowed) {
  const v = queryParam(query, name);
  if (v === undefined || v === '') return null;
  const s = String(v);
  if (!allowed.includes(s)) throw new V1Error(400, 'invalid_filter', `"${name}" aceita só ${allowed.join(' ou ')}.`);
  return s;
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
      admin.from('conversations')
        .select('id, remote_jid, contact_id, state, state_since, state_by, updated_at', { count: 'exact' })
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

    // conversations não tem FK para crm_contacts: segunda consulta com os contatos da página.
    const ids = [...new Set((data || []).map(c => c.contact_id).filter(Boolean))];
    const contacts = new Map();
    if (ids.length) {
      const { data: cs, error: cErr } = await admin.from('crm_contacts')
        .select('id, name').eq('company_id', companyId).in('id', ids);
      if (cErr) throw cErr;
      for (const c of cs || []) contacts.set(c.id, { id: c.id, name: c.name });
    }

    // Objeto Conversa do contrato. Em grupo, phone e contact são null e state é informativo.
    const items = (data || []).map(c => {
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
    });
    return paged(res, page, items, count);
  } catch (e) {
    console.error('[v1] conversations falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar as conversas.');
  }
}
