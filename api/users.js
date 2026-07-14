import { adminClient, userClient } from './_lib/db.js';

const ALLOWED_ROLES = ['admin', 'manager', 'seller'];

/**
 * Gestão de usuários da empresa (admin apenas). Consolidado num único endpoint
 * porque o plano Hobby do Vercel limita o número de serverless functions.
 *
 *   GET  /api/users                                  → lista os usuários da empresa
 *   POST /api/users  { action: 'create', ... }       → cria usuário
 *   POST /api/users  { action: 'update', userId, ...} → atualiza nome/papel/email/senha
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = userClient(authHeader);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const admin = adminClient();

  const { data: profile } = await admin
    .from('user_profiles').select('role, company_id').eq('id', user.id).single();
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  const companyId = profile.company_id;

  // ─── Listar ───
  if (req.method === 'GET') {
    const { data: users } = await admin
      .from('user_profiles').select('*').eq('company_id', companyId).order('name');
    return res.status(200).json({ users: users || [] });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body || {};

  // ─── Criar ───
  if (action === 'create') {
    const { name, email, password, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Papel inválido' });
    }

    const { data: authData, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error) return res.status(400).json({ error: error.message });

    // company_id vem SEMPRE do admin autenticado, nunca do corpo da requisição
    const { error: profileError } = await admin.from('user_profiles').insert({
      id: authData.user.id, company_id: companyId, name, role: role || 'seller', email,
      is_primary: false, active: true,
    });
    if (profileError) return res.status(400).json({ error: profileError.message });

    return res.status(200).json({ user: authData.user });
  }

  // ─── Atualizar ───
  if (action === 'update') {
    const { userId, email, password, name, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Papel inválido' });
    }

    // O alvo tem que ser da MESMA empresa (evita takeover cross-tenant)
    const { data: target } = await admin
      .from('user_profiles').select('company_id').eq('id', userId).single();
    if (!target || target.company_id !== companyId) {
      return res.status(403).json({ error: 'Usuário não pertence à sua empresa' });
    }

    if (email || password) {
      const updates = {};
      if (email) updates.email = email;
      if (password) updates.password = password;
      const { error } = await admin.auth.admin.updateUserById(userId, updates);
      if (error) return res.status(400).json({ error: error.message });
    }

    const profileUpdates = {};
    if (name) profileUpdates.name = name;
    if (role) profileUpdates.role = role;
    if (email) profileUpdates.email = email;
    if (Object.keys(profileUpdates).length > 0) {
      await admin.from('user_profiles').update(profileUpdates).eq('id', userId);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação inválida' });
}
