import { adminClient } from '../db.js';
import { V1Error, fail, readPaging, paged, readDate, isUuid, queryParam, isRangeBeyondEnd } from './http.js';
import { MESSAGE_COLS, toMessage } from './messages.js';
import { setConversationState } from '../conversations.js';
import { sendMessage } from '../sendMessage.js';

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

// PATCH /v1/conversations/{id} — alterna automation ↔ human. Reaproveita setConversationState
// (o mesmo do botão da tela). Grupo não pausa → 422. Mesmo estado → 200 sem mudança.
// Evento conversation.state_changed só na P1-W1 (no catálogo está available: false).
// Resposta: a Conversa (mesmo formato do GET, sem last_message).
export async function updateConversation(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'conversation_not_found', 'Conversa não encontrada.');
  if (!isUuid(params.id)) return notFound();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const state = body.state;
  if (state !== 'automation' && state !== 'human') {
    throw new V1Error(400, 'invalid_state', '"state" aceita só automation ou human.');
  }

  const admin = adminClient();
  try {
    const load = () => admin.from('conversations').select(CONV_COLS)
      .eq('company_id', companyId).eq('id', params.id).maybeSingle();
    let { data: c, error } = await load();
    if (error) throw error;
    if (!c) return notFound();
    if (jidInfo(c.remote_jid).type === 'group') {
      return fail(res, 422, 'unsupported_for_group', 'Grupos não alternam entre automação e humano.');
    }
    if (c.state !== state) {
      // actorUserId nulo + source 'api': o evento sai com changed_by: "api" (P1-W1)
      await setConversationState(c.id, state, null, 'api');
      ({ data: c, error } = await load());
      if (error) throw error;
    }
    const contacts = await loadContacts(admin, companyId, [c]);
    return res.status(200).json(toConversation(c, contacts));
  } catch (e) {
    console.error('[v1] update conversation falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao alterar a conversa.');
  }
}

// POST /v1/conversations/{id}/messages — envia pela conversa (sender = automation), com as
// mesmas regras do POST /v1/messages: 409 conversation_paused se estiver em human (grupo não
// pausa). Chama sendMessage, sem alterá-lo. 200 { ok, message_id, conversation_id }.
export async function sendConversationMessage(req, res, { companyId, params }) {
  const notFound = () => fail(res, 404, 'conversation_not_found', 'Conversa não encontrada.');
  if (!isUuid(params.id)) return notFound();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const content = typeof body.content === 'string' && body.content.trim() ? body.content : null;
  const media = body.media && typeof body.media === 'object' && !Array.isArray(body.media) ? body.media : null;
  if (body.media !== undefined && body.media !== null && (!media || typeof media.url !== 'string' || !media.url)) {
    throw new V1Error(400, 'invalid_field', '"media": objeto com url (e type: image, video ou document).');
  }
  if (!content && !media) throw new V1Error(400, 'missing_content', 'Envie "content" ou "media".');

  const admin = adminClient();
  let c;
  try {
    const { data, error } = await admin.from('conversations').select(CONV_COLS)
      .eq('company_id', companyId).eq('id', params.id).maybeSingle();
    if (error) throw error;
    c = data;
  } catch (e) {
    console.error('[v1] conversation send (leitura) falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar a conversa.');
  }
  if (!c) return notFound();

  const jid = String(c.remote_jid || '');
  const isGroup = jid.endsWith('@g.us');
  // Só JIDs que o sendMessage sabe entregar. @lid não é telefone. O JID individual já é o
  // número internacional: vai com "+" para o sendMessage não reinterpretá-lo (P1-E0; antes,
  // número estrangeiro de 10–11 dígitos ganharia 55, e a rota recusava com 422).
  if (!isGroup && !/^\d+@s\.whatsapp\.net$/.test(jid)) {
    return fail(res, 422, 'unsupported_jid', 'Esta conversa não aceita envio pela API (JID não suportado).');
  }
  // Pausa checada aqui também (antes do sendMessage), para nunca chegar perto da Evolution.
  if (!isGroup && c.state === 'human') {
    return res.status(409).json({ error: 'conversation_paused', message: 'A conversa está com um humano. Nada foi enviado.', conversation_id: c.id });
  }

  const to = isGroup ? jid : `+${jid.replace(/@.*/, '')}`;
  const result = await sendMessage({ companyId, to, content, media, sender: 'automation' });
  if (result.error) {
    const status = result.status || 400;
    return res.status(status).json({
      error: result.error,
      message: status === 409 ? 'A conversa está com um humano. Nada foi enviado.' : 'Não foi possível enviar.',
      conversation_id: result.conversationId || c.id,
    });
  }
  return res.status(200).json({ ok: true, message_id: result.messageId, conversation_id: result.conversationId });
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
