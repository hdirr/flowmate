import { supabase } from './supabase';

// Cliente das rotas de etiquetas da tela (api/conversations/[...path].js). Todas exigem a
// chave `labels` da empresa: desligada, o servidor responde 404 feature_off e a tela não
// mostra nada de etiqueta (labelsApi.list devolve null).
async function call(path, { method = 'GET', body } = {}) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  const res = await fetch(`/api/conversations/${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.message || 'Não foi possível concluir. Tente de novo.');
    err.status = res.status;
    err.code = data?.error;
    err.data = data;
    throw err;
  }
  return data;
}

export const labelsApi = {
  // { labels, can_manage } ou null quando a chave está desligada (404).
  list: async ({ counts = false } = {}) => {
    try { return await call(`labels${counts ? '?counts=1' : ''}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  },
  create: (name, color) => call('labels', { method: 'POST', body: { name, color } }),
  // "Criar na hora": cria (cinza) e devolve o id; se o nome padronizado já existe, devolve o
  // da existente (aplica a existente em vez de criar outra).
  createOrGet: async name => {
    try { return (await call('labels', { method: 'POST', body: { name } })).id; }
    catch (e) { if (e.status === 409 && e.data?.label_id) return e.data.label_id; throw e; }
  },
  update: (id, patch) => call(`labels?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  remove: id => call(`labels?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  map: () => call('label-map'),
  ofContact: contactId => call(`contact-labels?contact_id=${encodeURIComponent(contactId)}`),
  applyContact: (contactId, labelId, op) => call('contact-labels', { method: 'POST', body: { contact_id: contactId, label_id: labelId, op } }),
  ofConversation: to => call(`conversation-labels?to=${encodeURIComponent(to)}`),
  applyConversation: (to, labelId, op) => call('conversation-labels', { method: 'POST', body: { to, label_id: labelId, op } }),
};
