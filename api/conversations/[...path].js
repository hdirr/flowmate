import { adminClient, resolveUser, jidFor, twinJid } from '../_lib/db.js';
import { getOrCreateConversation, setConversationState, resumeAutomation, STATE } from '../_lib/conversations.js';
import { permissionChecker } from '../_lib/permissions.js';
import { V1Error, isUuid } from '../_lib/v1/http.js';
import {
  requireLabels, listLabels, createLabel, updateLabel, deleteLabel, labelMap, getLabel,
  labelsOfContacts, labelsOfConversations, applyContactLabels, applyConversationLabels,
} from '../_lib/labels.js';

// Catch-all da tela (login do Supabase). Era api/conversations/state.js: a rota `state` segue
// idêntica. As de etiquetas (PLANO-ETIQUETAS, ET-4) ficam atrás da chave `labels` (desligada:
// 404 feature_off) e conferem a permissão no servidor:
//   GET    labels[?counts=1]                → { labels, can_manage }
//   POST   labels { name, color }           → criar      (Configurações: settings.access)
//   PATCH  labels?id= { name?, color? }     → editar     (idem; sistema só a cor)
//   DELETE labels?id=                       → excluir    (idem; sistema nunca)
//   GET    label-map                        → { contacts: {id: [label_id]}, conversations: {jid: [label_id]} }
//   GET    contact-labels?contact_id=       → { labels }
//   POST   contact-labels { contact_id, label_id, op: add|remove }       (quem vê o contato ou o chat)
//   GET    conversation-labels?to=          → { labels } (conversa + gêmea)
//   POST   conversation-labels { to, label_id, op: add|remove }          (quem vê o chat)
// Uma rota por segmento: fora do Next.js a Vercel não entrega [...path] com várias partes.
export default async function handler(req, res) {
  const segments = req.query?.path ?? req.query?.['...path'];
  let route = Array.isArray(segments) ? segments.join('/') : (segments || '');
  if (!route) route = (req.url || '').split('?')[0].replace(/^\/(api\/)?conversations\//, '').replace(/\/+$/, '');

  const routes = { state: handleState, labels: handleLabels, 'label-map': handleLabelMap, 'contact-labels': handleContactLabels, 'conversation-labels': handleConversationLabels };
  const fn = routes[route];
  if (!fn) return res.status(404).json({ error: 'not_found' });

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });
  if (fn === handleState) return handleState(req, res, who);

  const admin = adminClient();
  try {
    await requireLabels(who.companyId, admin);
    return await fn(req, res, who, admin);
  } catch (e) {
    if (e instanceof V1Error) return res.status(e.status).json({ error: e.error, message: e.message });
    console.error(`[conversations/${route}] falhou:`, e?.message || e);
    return res.status(500).json({ error: 'internal_error', message: 'Erro ao processar as etiquetas.' });
  }
}

// ─── state (antigo state.js, sem mudança) ───
// GET  /api/conversations/state?to=5531999998888   → { state, state_since, state_by }
// POST /api/conversations/state  { to, state }     → transiciona (retomada manual)
//
// human → automation é SEMPRE manual. Nada de auto-retomada por tempo: o dono foi almoçar
// e a automação voltaria do nada dizendo "Como posso ajudar?".
//
// Conversa gêmea (mesmo celular BR com/sem o 9º dígito, P1-E0b): o GET mostra human se
// qualquer uma das duas estiver em human (é o que o envio automático respeita), e "devolver
// para automação" retoma as duas.
async function handleState(req, res, who) {
  const to = req.method === 'GET' ? req.query?.to : req.body?.to;
  if (!to) return res.status(400).json({ error: 'Parâmetro "to" obrigatório' });

  const remoteJid = jidFor(to);

  if (req.method === 'GET') {
    const admin = adminClient();
    const twin = twinJid(remoteJid);
    const { data, error } = await admin
      .from('conversations')
      .select('id, remote_jid, state, state_since, state_by')
      .eq('company_id', who.companyId)
      .in('remote_jid', twin ? [remoteJid, twin] : [remoteJid]);
    // Leitura falhou: não afirma "automação" (a tela mantém o que já mostrava).
    if (error) return res.status(503).json({ error: 'state_unavailable' });
    const list = data || [];
    const pick = list.find(c => c.state !== STATE.AUTOMATION) || list.find(c => c.remote_jid === remoteJid) || list[0];
    // Sem conversa ainda = automação (default)
    if (!pick) return res.status(200).json({ state: STATE.AUTOMATION, state_since: null, state_by: null });
    return res.status(200).json({ id: pick.id, state: pick.state, state_since: pick.state_since, state_by: pick.state_by });
  }

  if (req.method === 'POST') {
    const { state } = req.body || {};
    if (state !== STATE.AUTOMATION && state !== STATE.HUMAN) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const conversation = await getOrCreateConversation(who.companyId, remoteJid);
    if (!conversation) return res.status(503).json({ error: 'conversation_unavailable' });
    // source 'user': veio do botão da tela (ao devolver para automação o actor vai nulo e,
    // sem isto, o evento sairia como 'phone').
    if (state === STATE.AUTOMATION) {
      await resumeAutomation(conversation, who.companyId, null, 'user');
    } else {
      await setConversationState(conversation.id, state, who.userId, 'user');
    }
    return res.status(200).json({ ok: true, state });
  }

  return res.status(405).end();
}

// ─── permissões (as mesmas da tela: role_permissions + padrão; admin pode tudo) ───
async function permissionsOf(admin, who) {
  const { data: profile, error } = await admin.from('user_profiles')
    .select('role').eq('id', who.userId).eq('company_id', who.companyId).maybeSingle();
  if (error) throw error;
  const role = profile?.role || null;
  if (!role) return () => false;
  if (role === 'admin') return () => true;
  const { data: rows, error: pErr } = await admin.from('role_permissions')
    .select('module, action, enabled').eq('company_id', who.companyId).eq('role', role);
  if (pErr) throw pErr;
  return permissionChecker(role, rows);
}
const forbidden = msg => new V1Error(403, 'forbidden', msg);
const USER = who => ({ source: 'user', userId: who.userId });
const canSeeChats = can => can('chats', 'view_all') || can('chats', 'view_own');

// ─── labels (lista + CRUD) ───
async function handleLabels(req, res, who, admin) {
  const can = await permissionsOf(admin, who);
  const canManage = can('settings', 'access');
  if (req.method === 'GET') {
    const withCounts = req.query?.counts === '1';
    const labels = await listLabels(admin, who.companyId, { withCounts });
    return res.status(200).json({ labels, can_manage: canManage });
  }
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  if (!canManage) throw forbidden('Só quem acessa Configurações cria, edita ou exclui etiquetas.');
  if (req.method === 'POST') {
    return res.status(201).json(await createLabel(admin, who.companyId, req.body, USER(who)));
  }
  const id = String(req.query?.id || '');
  if (!isUuid(id)) throw new V1Error(404, 'label_not_found', 'Etiqueta não encontrada.');
  if (req.method === 'PATCH') {
    const { label, changes } = await updateLabel(admin, who.companyId, id, req.body, USER(who));
    return res.status(200).json({ ...label, changes });
  }
  const r = await deleteLabel(admin, who.companyId, id, USER(who));
  return res.status(200).json({ ok: true, id: r.label.id, contacts_removed: r.contacts_removed, conversations_removed: r.conversations_removed });
}

async function handleLabelMap(req, res, who, admin) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  return res.status(200).json(await labelMap(admin, who.companyId));
}

// Uma etiqueta por vez (tela): op add|remove → as operações da /v1.
function readOp(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (b.op !== 'add' && b.op !== 'remove') throw new V1Error(400, 'invalid_operation', '"op" aceita add ou remove.');
  if (!isUuid(String(b.label_id || ''))) throw new V1Error(404, 'label_not_found', 'Etiqueta não encontrada.');
  return { op: b.op === 'add' ? 'InsertIfNotExists' : 'DeleteIfExists', labelId: b.label_id };
}

// ─── etiquetas do contato ───
async function handleContactLabels(req, res, who, admin) {
  const contactId = String((req.method === 'GET' ? req.query?.contact_id : req.body?.contact_id) || '');
  const notFound = () => new V1Error(404, 'contact_not_found', 'Contato não encontrado.');
  if (!isUuid(contactId)) throw notFound();
  const { data: c, error } = await admin.from('crm_contacts')
    .select('id, created_by').eq('company_id', who.companyId).eq('id', contactId).maybeSingle();
  if (error) throw error;
  if (!c) throw notFound();
  if (req.method === 'GET') {
    return res.status(200).json({ labels: (await labelsOfContacts(admin, who.companyId, [c.id])).get(c.id) || [] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  // Quem vê o contato (Contatos: todos, ou os próprios) ou o chat (o painel do contato abre no Chats).
  const can = await permissionsOf(admin, who);
  const seesContact = can('contacts', 'view_all') || (can('contacts', 'view_own') && c.created_by === who.userId);
  if (!seesContact && !canSeeChats(can)) throw forbidden('Sem permissão para alterar as etiquetas deste contato.');
  const { op, labelId } = readOp(req.body);
  const r = await applyContactLabels(admin, who.companyId, c.id, [labelId], op, USER(who));
  return res.status(200).json({ labels: r.labels });
}

// ─── etiquetas da conversa (por telefone "+55…" ou JID de grupo, como a rota state) ───
function jidOfTarget(to) {
  const s = String(to || '').trim();
  if (!s) throw new V1Error(400, 'missing_to', 'Parâmetro "to" obrigatório.');
  if (s.endsWith('@g.us')) return s;
  return jidFor(s);
}

async function handleConversationLabels(req, res, who, admin) {
  const can = await permissionsOf(admin, who);
  if (!canSeeChats(can)) throw forbidden('Sem permissão para ver os chats.');
  const jid = jidOfTarget(req.method === 'GET' ? req.query?.to : req.body?.to);
  const twin = twinJid(jid);
  const readConvs = async () => {
    const { data, error } = await admin.from('conversations').select('id, remote_jid, contact_id, state')
      .eq('company_id', who.companyId).in('remote_jid', twin ? [jid, twin] : [jid]);
    if (error) throw error;
    return data || [];
  };
  // Conversa + gêmea, sem repetir (a lista do Chats junta as duas).
  const union = async convs => {
    const map = await labelsOfConversations(admin, who.companyId, convs.map(c => c.id));
    const seen = new Map();
    for (const c of convs) for (const l of map.get(c.id) || []) if (!seen.has(l.id)) seen.set(l.id, l);
    return [...seen.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'pt-BR') : a.kind === 'system' ? -1 : 1));
  };

  if (req.method === 'GET') return res.status(200).json({ labels: await union(await readConvs()) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { op, labelId } = readOp(req.body);
  const label = await getLabel(admin, who.companyId, labelId);
  if (!label) throw new V1Error(404, 'label_not_found', 'Etiqueta não encontrada.');
  const conv = await getOrCreateConversation(who.companyId, jid, admin);
  if (!conv) throw new V1Error(503, 'conversation_unavailable', 'Conversa indisponível agora. Tente de novo.');
  await applyConversationLabels(admin, who.companyId, conv, [labelId], op, USER(who));
  // Remover etiqueta de usuário tira também da gêmea (senão o chip continuaria na lista).
  if (op === 'DeleteIfExists' && label.kind === 'user' && twin) {
    const other = (await readConvs()).find(c => c.remote_jid === twin);
    if (other) await applyConversationLabels(admin, who.companyId, other, [labelId], op, USER(who));
  }
  return res.status(200).json({ labels: await union(await readConvs()) });
}
