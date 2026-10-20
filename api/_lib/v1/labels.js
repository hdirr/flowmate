import { adminClient } from '../db.js';
import { V1Error, fail, readPaging, paged, queryParam, isUuid } from './http.js';
import {
  requireLabels, listLabels, getLabel, createLabel, updateLabel, deleteLabel,
  readApplyBody, applyContactLabels, applyConversationLabels,
} from '../labels.js';
import { toConversationWithLabels, CONV_COLS } from './conversations.js';

// Etiquetas na /v1 (PLANO-ETIQUETAS, ET-2). Tudo atrás da chave `labels`: desligada → 404
// feature_off. A regra está em api/_lib/labels.js (a mesma da tela); aqui só a borda HTTP.
const API = { source: 'api', userId: null };

function wrap(fn, what) {
  return async (req, res, ctx) => {
    const admin = adminClient();
    try {
      await requireLabels(ctx.companyId, admin);
      return await fn(req, res, ctx, admin);
    } catch (e) {
      if (e instanceof V1Error) {
        return res.status(e.status).json({ error: e.error, message: e.message, ...(e.missing ? { missing: e.missing } : {}), ...(e.extra || {}) });
      }
      console.error(`[v1] ${what} falhou:`, e?.message || e);
      return fail(res, 500, 'internal_error', `Erro ao ${what}.`);
    }
  };
}

// GET /v1/labels — lista paginada (sistema primeiro, depois por nome). Filtro kind=user|system.
export const listLabelsRoute = wrap(async (req, res, { companyId }, admin) => {
  const q = req.query || {};
  const kind = queryParam(q, 'kind');
  if (kind !== undefined && kind !== '' && kind !== 'user' && kind !== 'system') {
    throw new V1Error(400, 'invalid_filter', '"kind" aceita só user ou system.');
  }
  const page = readPaging(q);
  const all = await listLabels(admin, companyId, { kind: kind || null });
  return paged(res, page, all.slice(page.from, page.to + 1), all.length);
}, 'consultar as etiquetas');

// GET /v1/labels/{id}
export const getLabelRoute = wrap(async (req, res, { companyId, params }, admin) => {
  const l = await getLabel(admin, companyId, params.id);
  if (!l) return fail(res, 404, 'label_not_found', 'Etiqueta não encontrada.');
  return res.status(200).json(l);
}, 'consultar a etiqueta');

// POST /v1/labels { name, color? } → 201 Etiqueta (kind user). Nome repetido → 409.
export const createLabelRoute = wrap(async (req, res, { companyId }, admin) => {
  const l = await createLabel(admin, companyId, req.body, API);
  return res.status(201).json(l);
}, 'criar a etiqueta');

// PATCH /v1/labels/{id} { name?, color? } → 200 Etiqueta + changes. Sistema: só a cor.
export const updateLabelRoute = wrap(async (req, res, { companyId, params }, admin) => {
  if (!isUuid(params.id)) return fail(res, 404, 'label_not_found', 'Etiqueta não encontrada.');
  const { label, changes } = await updateLabel(admin, companyId, params.id, req.body, API);
  return res.status(200).json({ ...label, changes });
}, 'alterar a etiqueta');

// DELETE /v1/labels/{id} → 200 { ok, id, name, contacts_removed, conversations_removed }.
export const deleteLabelRoute = wrap(async (req, res, { companyId, params }, admin) => {
  if (!isUuid(params.id)) return fail(res, 404, 'label_not_found', 'Etiqueta não encontrada.');
  const r = await deleteLabel(admin, companyId, params.id, API);
  return res.status(200).json({ ok: true, id: r.label.id, name: r.label.name, contacts_removed: r.contacts_removed, conversations_removed: r.conversations_removed });
}, 'excluir a etiqueta');

// POST /v1/contacts/{id}/labels { labels: [id ou nome], operation } → 200
// { ok, contact_id, labels, added, removed, tags }. Etiqueta de sistema → 422.
export const contactLabelsRoute = wrap(async (req, res, { companyId, params }, admin) => {
  if (!isUuid(params.id)) return fail(res, 404, 'contact_not_found', 'Contato não encontrado.');
  const { operation, refs } = readApplyBody(req.body);
  const r = await applyContactLabels(admin, companyId, params.id, refs, operation, API);
  return res.status(200).json({ ok: true, ...r });
}, 'alterar as etiquetas do contato');

// POST /v1/conversations/{id}/labels { labels, operation } → 200 Conversa (com labels) +
// added/removed. Sistema: exclusivas, sem remover, só em individual; vale também na gêmea.
export const conversationLabelsRoute = wrap(async (req, res, { companyId, params }, admin) => {
  const notFound = () => fail(res, 404, 'conversation_not_found', 'Conversa não encontrada.');
  if (!isUuid(params.id)) return notFound();
  const { operation, refs } = readApplyBody(req.body);
  const load = () => admin.from('conversations').select(CONV_COLS)
    .eq('company_id', companyId).eq('id', params.id).maybeSingle();
  const { data: c, error } = await load();
  if (error) throw error;
  if (!c) return notFound();
  const r = await applyConversationLabels(admin, companyId, c, refs, operation, API);
  const { data: after, error: aErr } = await load();
  if (aErr) throw aErr;
  const [conv] = await toConversationWithLabels(admin, companyId, [after || c], true);
  return res.status(200).json({ ...conv, added: r.added, removed: r.removed });
}, 'alterar as etiquetas da conversa');
