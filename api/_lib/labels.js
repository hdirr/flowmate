import { dispatchWebhook } from './webhooks.js';
import { isFeatureOn } from './features.js';
import { setConversationState, resumeAutomation, findTwinConversation, STATE } from './conversations.js';
import { V1Error, isUuid } from './v1/http.js';
import { DEFAULT_LABEL_COLOR, LABEL_COLORS, paletteColor } from './labelColors.js';
import { labelSlug } from './labelName.js';

// Etiquetas (PLANO-ETIQUETAS, ET-2) — regra única para a /v1 e para a tela.
//
// Fase A (SQL da CF-A, PARTE 6, aplicado):
// - Etiqueta de USUÁRIO em contato = o array crm_contacts.tags (a fonte). Aplicar/remover
//   escreve no array; o gatilho do banco reflete em contact_labels. Assim o contrato da E3
//   (tags) continua igual e espelhado.
// - Etiqueta de USUÁRIO em conversa = linha em conversation_labels (gravada aqui).
// - Etiqueta de SISTEMA ("Atendimento humano"/"Atendimento IA") = o estado da conversa: aplicar
//   uma muda o estado pelo mesmo caminho do botão/PATCH de hoje (setConversationState /
//   resumeAutomation, com a gêmea), e o gatilho troca a etiqueta. Nunca em contato nem em grupo;
//   não dá para remover (só trocar pela outra).
// - Renomear/excluir: funções do banco rename_label/delete_label (mantêm os arrays de tags).
//
// Tudo atrás da chave `labels` (companies.features). Erros saem como V1Error (o roteador da
// /v1 e o catch-all da tela convertem em resposta).

export const LABEL_OPS = ['InsertIfNotExists', 'DeleteIfExists', 'ReplaceAll'];
const MAX_REFS = 50;
const LABEL_COLS = 'id, name, color, kind, system_key, created_at, updated_at';
const PAGE = 1000;
const MAX_ROWS = 50000;

export function labelsEnabled(companyId, admin) {
  return isFeatureOn(companyId, 'labels', admin);
}

export async function requireLabels(companyId, admin) {
  if (!(await labelsEnabled(companyId, admin))) {
    throw new V1Error(404, 'feature_off', 'Etiquetas não estão ativas nesta empresa.');
  }
}

// Objeto Etiqueta do contrato
export function toLabel(l) {
  return { id: l.id, name: l.name, color: l.color, kind: l.kind, system_key: l.system_key ?? null, created_at: l.created_at, updated_at: l.updated_at };
}
// Forma curta (dentro de Contato, Conversa e dos eventos)
export function brief(l) {
  return { id: l.id, name: l.name, color: l.color, kind: l.kind };
}

function isIndividualJid(jid) {
  const s = String(jid || '');
  return !!s && !s.endsWith('@g.us') && !s.endsWith('@broadcast') && !s.endsWith('@newsletter');
}

// O webhook do cliente nunca segura nem derruba a escrita (limite de 3 s, erro só no log).
async function emit(companyId, event, data) {
  try {
    await Promise.race([
      dispatchWebhook(companyId, event, data),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
  } catch (e) { console.error(`[labels] webhook ${event} falhou:`, e?.message || e); }
}

// Ordem estável: sistema primeiro (humano, IA), depois por nome.
function sortLabels(list) {
  const rank = l => (l.kind === 'system' ? (l.system_key === 'human' ? 0 : 1) : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR'));
}

// Lê todas as linhas (o Supabase corta em 1000 por consulta).
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function listLabels(admin, companyId, { kind = null, withCounts = false } = {}) {
  let q = admin.from('labels').select(LABEL_COLS).eq('company_id', companyId);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw error;
  const list = sortLabels((data || []).map(toLabel));
  if (!withCounts) return list;
  await Promise.all(list.map(async l => Object.assign(l, await countUsage(admin, companyId, l.id))));
  return list;
}

export async function getLabel(admin, companyId, id) {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from('labels').select(LABEL_COLS)
    .eq('company_id', companyId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toLabel(data) : null;
}

// Quantos contatos e conversas usam a etiqueta (a confirmação de exclusão mostra isto).
export async function countUsage(admin, companyId, labelId) {
  const [c, v] = await Promise.all([
    admin.from('contact_labels').select('label_id', { count: 'exact', head: true }).eq('company_id', companyId).eq('label_id', labelId),
    admin.from('conversation_labels').select('label_id', { count: 'exact', head: true }).eq('company_id', companyId).eq('label_id', labelId),
  ]);
  if (c.error) throw c.error;
  if (v.error) throw v.error;
  return { contacts_count: c.count || 0, conversations_count: v.count || 0 };
}

// contactIds → Map(contact_id → [etiqueta curta])
export async function labelsOfContacts(admin, companyId, contactIds) {
  const map = new Map();
  const ids = [...new Set((contactIds || []).filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await admin.from('contact_labels')
    .select('contact_id, label:labels(id, name, color, kind, system_key)')
    .eq('company_id', companyId).in('contact_id', ids);
  if (error) throw error;
  for (const row of data || []) {
    if (!row.label) continue;
    if (!map.has(row.contact_id)) map.set(row.contact_id, []);
    map.get(row.contact_id).push(row.label);
  }
  for (const [k, v] of map) map.set(k, sortLabels(v).map(brief));
  return map;
}

// conversationIds → Map(conversation_id → [etiqueta curta])
export async function labelsOfConversations(admin, companyId, conversationIds) {
  const map = new Map();
  const ids = [...new Set((conversationIds || []).filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await admin.from('conversation_labels')
    .select('conversation_id, label:labels(id, name, color, kind, system_key)')
    .eq('company_id', companyId).in('conversation_id', ids);
  if (error) throw error;
  for (const row of data || []) {
    if (!row.label) continue;
    if (!map.has(row.conversation_id)) map.set(row.conversation_id, []);
    map.get(row.conversation_id).push(row.label);
  }
  for (const [k, v] of map) map.set(k, sortLabels(v).map(brief));
  return map;
}

// Mapa da tela (lista do Chats e de Contatos): quais etiquetas cada contato e cada conversa
// (por remote_jid) têm. Só ids; os nomes/cores vêm da lista de etiquetas.
export async function labelMap(admin, companyId) {
  const [cl, vl] = await Promise.all([
    fetchAll(() => admin.from('contact_labels').select('contact_id, label_id')
      .eq('company_id', companyId).order('contact_id').order('label_id')),
    fetchAll(() => admin.from('conversation_labels').select('conversation_id, label_id, conversation:conversations(remote_jid)')
      .eq('company_id', companyId).order('conversation_id').order('label_id')),
  ]);
  const contacts = {};
  for (const r of cl) (contacts[r.contact_id] ||= []).push(r.label_id);
  const conversations = {};
  for (const r of vl) {
    const jid = r.conversation?.remote_jid;
    if (jid) (conversations[jid] ||= []).push(r.label_id);
  }
  return { contacts, conversations };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

// Nome de etiqueta de usuário: sempre o slug (minúsculas, sem acento, hífens). Vazio depois
// de padronizar → 400.
function readName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new V1Error(400, 'invalid_name', '"name" precisa ser um texto de 1 a 100 caracteres (até 200 antes de padronizar).');
  }
  const name = labelSlug(value);
  if (name.length > 100) throw new V1Error(400, 'invalid_name', '"name" fica com mais de 100 caracteres depois de padronizar.');
  if (!name) {
    throw new V1Error(400, 'invalid_name', `"${value.trim()}" fica vazio depois de padronizar: use letras ou números.`);
  }
  return name;
}

// Tags da E3 / POST /v1/contacts com a chave labels ligada: o mesmo slug, sem repetir (ordem
// mantida). empty: as que ficaram vazias (quem chama responde 400).
export function normalizeTags(list) {
  const tags = [];
  const empty = [];
  for (const t of list) {
    const s = labelSlug(t);
    if (!s) empty.push(t);
    else if (!tags.includes(s)) tags.push(s);
  }
  return { tags, empty };
}
function readColor(value) {
  const c = paletteColor(value);
  if (!c) throw new V1Error(400, 'invalid_color', `"color" precisa ser uma cor da paleta: ${LABEL_COLORS.map(x => x.color).join(', ')}.`);
  return c;
}
const isUnique = e => e?.code === '23505' || /duplicate key|unique/i.test(e?.message || '');
// 409 com o id da existente (a tela usa para aplicar a existente em vez de criar outra).
async function labelExists(admin, companyId, name) {
  const err = new V1Error(409, 'label_exists', `Já existe uma etiqueta com o nome "${name}".`);
  try {
    const { data } = await admin.from('labels').select('id').eq('company_id', companyId).eq('name', name).maybeSingle();
    if (data?.id) err.extra = { label_id: data.id, name };
  } catch { /* só o 409 */ }
  return err;
}
const labelNotFound = () => new V1Error(404, 'label_not_found', 'Etiqueta não encontrada.');
const labelIsSystem = msg => new V1Error(422, 'label_is_system', msg);
const SYSTEM_NAME_MSG = 'Etiqueta de sistema: o nome não muda e ela não pode ser excluída (as automações e a pausa da conversa dependem dela). Só a cor pode mudar.';

// ctx: { source: 'api' | 'user', userId }
export async function createLabel(admin, companyId, body, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const name = readName(body.name);
  const color = body.color === undefined || body.color === null || body.color === '' ? DEFAULT_LABEL_COLOR : readColor(body.color);
  const { data, error } = await admin.from('labels')
    .insert({ company_id: companyId, name, color, kind: 'user', created_by: ctx.userId || null })
    .select(LABEL_COLS).single();
  if (error) {
    if (isUnique(error)) throw await labelExists(admin, companyId, name);
    throw error;
  }
  const label = toLabel(data);
  await emit(companyId, 'label.created', { label, source: ctx.source, user_id: ctx.userId || null });
  return label;
}

export async function updateLabel(admin, companyId, id, body, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  if (body.name === undefined && body.color === undefined) throw new V1Error(400, 'invalid_body', 'Envie "name" e/ou "color".');
  if (body.name !== undefined && typeof body.name !== 'string') throw new V1Error(400, 'invalid_name', '"name" precisa ser um texto de 1 a 100 caracteres.');
  const color = body.color === undefined ? undefined : readColor(body.color);
  const before = await getLabel(admin, companyId, id);
  if (!before) throw labelNotFound();
  // Sistema: o nome é o de sempre (sem slug); mandar o mesmo nome é aceito, outro → 422.
  if (before.kind === 'system' && body.name !== undefined && body.name.trim() !== before.name) throw labelIsSystem(SYSTEM_NAME_MSG);
  const name = body.name === undefined || before.kind === 'system' ? undefined : readName(body.name);
  const renaming = name !== undefined && name !== before.name;
  const recoloring = color !== undefined && color !== before.color;

  if (renaming) {
    // Renomeia e troca o nome nos arrays de tags, numa transação (função do banco).
    const { error } = await admin.rpc('rename_label', { p_label: before.id, p_company: companyId, p_name: name });
    if (error) {
      if (isUnique(error)) throw await labelExists(admin, companyId, name);
      if (/label_is_system/.test(error.message || '')) throw labelIsSystem(SYSTEM_NAME_MSG);
      if (/label_not_found/.test(error.message || '')) throw labelNotFound();
      throw error;
    }
  }
  if (recoloring) {
    const { error } = await admin.from('labels').update({ color, updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('id', before.id);
    if (error) throw error;
  }
  const after = (renaming || recoloring) ? await getLabel(admin, companyId, before.id) : before;
  if (!after) throw labelNotFound();
  const changes = [...(renaming ? ['name'] : []), ...(recoloring ? ['color'] : [])];
  if (changes.length) {
    await emit(companyId, 'label.updated', {
      label: after, changes, previous: { name: before.name, color: before.color },
      source: ctx.source, user_id: ctx.userId || null,
    });
  }
  return { label: after, changes };
}

export async function deleteLabel(admin, companyId, id, ctx) {
  const label = await getLabel(admin, companyId, id);
  if (!label) throw labelNotFound();
  if (label.kind === 'system') throw labelIsSystem(SYSTEM_NAME_MSG);
  const usage = await countUsage(admin, companyId, label.id);
  // Tira o nome dos arrays de tags e apaga (cascata em contact_labels/conversation_labels).
  const { error } = await admin.rpc('delete_label', { p_label: label.id, p_company: companyId });
  if (error) {
    if (/label_is_system/.test(error.message || '')) throw labelIsSystem(SYSTEM_NAME_MSG);
    if (/label_not_found/.test(error.message || '')) throw labelNotFound();
    throw error;
  }
  const out = { label, contacts_removed: usage.contacts_count, conversations_removed: usage.conversations_count };
  await emit(companyId, 'label.deleted', { ...out, source: ctx.source, user_id: ctx.userId || null });
  return out;
}

// ─── Aplicar / remover ──────────────────────────────────────────────────────

// Corpo { labels: [id ou nome], operation } (mesmos nomes da E3). Vazia só com ReplaceAll.
export function readApplyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new V1Error(400, 'invalid_body', 'Envie um objeto JSON.');
  const operation = body.operation === undefined ? 'InsertIfNotExists' : body.operation;
  if (!LABEL_OPS.includes(operation)) throw new V1Error(400, 'invalid_operation', `"operation" aceita: ${LABEL_OPS.join(', ')}.`);
  const raw = body.labels;
  if (!Array.isArray(raw) || raw.length > MAX_REFS || (raw.length === 0 && operation !== 'ReplaceAll')
      || raw.some(t => typeof t !== 'string' || !t.trim() || t.trim().length > 100)) {
    throw new V1Error(400, 'invalid_labels', `"labels" precisa ser uma lista de 1 a ${MAX_REFS} ids ou nomes de etiqueta; vazia só com ReplaceAll.`);
  }
  return { operation, refs: [...new Set(raw.map(t => t.trim()))] };
}

// ids ou nomes (exatos) → etiquetas da empresa. Algum não existe → 422 com a lista.
export async function resolveLabelRefs(admin, companyId, refs) {
  if (!refs.length) return [];
  const all = await listLabels(admin, companyId);
  const found = [];
  const missing = [];
  for (const r of refs) {
    // id, nome exato (as de sistema têm o nome de sempre) ou o slug de uma de usuário
    // ("Promoção Natal" acha "promocao-natal").
    const l = all.find(x => x.id === r) || all.find(x => x.name === r)
      || all.find(x => x.kind === 'user' && x.name === labelSlug(r));
    if (!l) missing.push(r);
    else if (!found.some(f => f.id === l.id)) found.push(l);
  }
  if (missing.length) {
    const err = new V1Error(422, 'label_not_found', `Etiqueta não encontrada: ${missing.join(', ')}. Crie antes em POST /v1/labels.`);
    err.missing = missing;
    throw err;
  }
  return found;
}

function diff(before, after) {
  const b = new Set(before.map(l => l.id));
  const a = new Set(after.map(l => l.id));
  return { added: after.filter(l => !b.has(l.id)), removed: before.filter(l => !a.has(l.id)) };
}

// Contato: só etiquetas de usuário (escreve no array tags; o gatilho espelha).
// ctx: { source, userId }. Devolve { contact_id, labels, added, removed, tags }.
export async function applyContactLabels(admin, companyId, contactId, refs, operation, ctx) {
  if (!isUuid(contactId)) throw new V1Error(404, 'contact_not_found', 'Contato não encontrado.');
  const { data: c, error } = await admin.from('crm_contacts')
    .select('id, tags').eq('company_id', companyId).eq('id', contactId).maybeSingle();
  if (error) throw error;
  if (!c) throw new V1Error(404, 'contact_not_found', 'Contato não encontrado.');

  const wanted = await resolveLabelRefs(admin, companyId, refs);
  if (wanted.some(l => l.kind === 'system')) {
    throw labelIsSystem('Etiqueta de sistema só vale em conversa individual (nunca em contato).');
  }
  const names = wanted.map(l => l.name);
  const cur = c.tags || [];
  let next;
  if (operation === 'InsertIfNotExists') next = [...cur, ...names.filter(t => !cur.includes(t))];
  else if (operation === 'DeleteIfExists') next = cur.filter(t => !names.includes(t));
  else next = names;
  const tagsAdded = next.filter(t => !cur.includes(t));
  const tagsRemoved = cur.filter(t => !next.includes(t));

  const before = (await labelsOfContacts(admin, companyId, [c.id])).get(c.id) || [];
  if (tagsAdded.length || tagsRemoved.length) {
    const { error: uErr } = await admin.from('crm_contacts').update({ tags: next })
      .eq('company_id', companyId).eq('id', c.id);
    if (uErr) throw uErr;
  }
  const after = (await labelsOfContacts(admin, companyId, [c.id])).get(c.id) || [];
  const { added, removed } = diff(before, after);
  if (tagsAdded.length || tagsRemoved.length) {
    // O contrato da E3 continua: as tags mudaram → contact.tags_updated, como sempre.
    await emit(companyId, 'contact.tags_updated', { contact_id: c.id, tags: next, added: tagsAdded, removed: tagsRemoved, source: ctx.source });
  }
  if (added.length || removed.length) {
    await emit(companyId, 'contact.labels_updated', { contact_id: c.id, labels: after, added, removed, source: ctx.source, user_id: ctx.userId || null });
  }
  return { contact_id: c.id, labels: after, added, removed, tags: tagsAdded.length || tagsRemoved.length ? next : cur };
}

// Etiquetas atuais do contato, ou null se a leitura falhar (quem chama segue sem o evento,
// nunca falha por causa disso).
export async function contactLabelsOrNull(admin, companyId, contactId) {
  try { return (await labelsOfContacts(admin, companyId, [contactId])).get(contactId) || []; }
  catch (e) { console.error('[labels] leitura das etiquetas do contato falhou:', e?.message || e); return null; }
}

// Depois de uma escrita em tags por outro caminho (E3, POST /v1/contacts): compara com o
// antes e solta contact.labels_updated se mudou. Só com a chave ligada; nunca derruba a rota.
export async function emitContactLabelsDiff(admin, companyId, contactId, before, ctx) {
  if (before === null) return; // o "antes" não foi lido: sem como comparar
  try {
    if (!(await labelsEnabled(companyId, admin))) return;
    const after = (await labelsOfContacts(admin, companyId, [contactId])).get(contactId) || [];
    const { added, removed } = diff(before || [], after);
    if (added.length || removed.length) {
      await emit(companyId, 'contact.labels_updated', { contact_id: contactId, labels: after, added, removed, source: ctx.source, user_id: ctx.userId || null });
    }
  } catch (e) { console.error('[labels] diff do contato falhou:', e?.message || e); }
}

// Conversa. conv: { id, remote_jid, contact_id, state } (já filtrada pela empresa).
// Usuário: grava em conversation_labels. Sistema: troca o estado (com a gêmea) pelo caminho
// de sempre; o gatilho troca a etiqueta. Um evento conversation.labels_updated desta conversa
// (a gêmea, se mudar, solta o dela pelo setConversationState).
export async function applyConversationLabels(admin, companyId, conv, refs, operation, ctx) {
  const wanted = await resolveLabelRefs(admin, companyId, refs);
  const wantedSystem = wanted.filter(l => l.kind === 'system');
  const wantedUser = wanted.filter(l => l.kind === 'user');
  const individual = isIndividualJid(conv.remote_jid);

  if (wantedSystem.length && !individual) {
    throw new V1Error(422, 'unsupported_for_group', 'Etiqueta de sistema só vale em conversa individual (grupo não tem atendimento humano/IA).');
  }
  if (operation === 'DeleteIfExists' && wantedSystem.length) {
    throw new V1Error(422, 'system_label_required', 'A conversa precisa de uma etiqueta de sistema: aplique a outra (Atendimento humano ↔ Atendimento IA) em vez de remover.');
  }
  if (wantedSystem.length > 1) {
    throw new V1Error(422, 'system_labels_exclusive', 'Atendimento humano e Atendimento IA são exclusivas: envie só uma.');
  }

  const before = (await labelsOfConversations(admin, companyId, [conv.id])).get(conv.id) || [];
  const curUser = before.filter(l => l.kind === 'user').map(l => l.id);
  const wantUser = wantedUser.map(l => l.id);
  let toAdd = [], toRemove = [];
  if (operation === 'InsertIfNotExists') toAdd = wantUser.filter(id => !curUser.includes(id));
  else if (operation === 'DeleteIfExists') toRemove = wantUser.filter(id => curUser.includes(id));
  else { toAdd = wantUser.filter(id => !curUser.includes(id)); toRemove = curUser.filter(id => !wantUser.includes(id)); }

  if (toAdd.length) {
    const { error } = await admin.from('conversation_labels').upsert(
      toAdd.map(label_id => ({ company_id: companyId, conversation_id: conv.id, label_id, source: ctx.source })),
      { onConflict: 'conversation_id,label_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  if (toRemove.length) {
    const { error } = await admin.from('conversation_labels').delete()
      .eq('company_id', companyId).eq('conversation_id', conv.id).in('label_id', toRemove);
    if (error) throw error;
  }

  // Sistema (ReplaceAll sem etiqueta de sistema mantém a atual).
  if (wantedSystem.length) {
    const key = wantedSystem[0].system_key;
    if (key === 'ai') {
      await resumeAutomation(conv, companyId, null, ctx.source, admin, { quietLabelsFor: conv.id });
    } else {
      if (conv.state !== STATE.HUMAN) await setConversationState(conv.id, STATE.HUMAN, ctx.userId || null, ctx.source, admin, { quietLabels: true });
      const { twin, error } = await findTwinConversation(companyId, conv.remote_jid, admin);
      if (error) console.error('[labels] gêmea não lida ao aplicar Atendimento humano');
      if (twin && twin.state !== STATE.HUMAN) await setConversationState(twin.id, STATE.HUMAN, ctx.userId || null, ctx.source, admin);
    }
  }

  const after = (await labelsOfConversations(admin, companyId, [conv.id])).get(conv.id) || [];
  const { added, removed } = diff(before, after);
  if (added.length || removed.length) {
    await emit(companyId, 'conversation.labels_updated', {
      conversation_id: conv.id, contact_id: conv.contact_id ?? null, remote_jid: conv.remote_jid,
      labels: after, added, removed, source: ctx.source, user_id: ctx.userId || null,
    });
  }
  return { conversation_id: conv.id, labels: after, added, removed };
}
