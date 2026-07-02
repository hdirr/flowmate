import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  const { userId, email, password, name, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Garante que o usuário alvo pertence à MESMA empresa do admin (evita acesso cross-tenant)
  const { data: target } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', userId)
    .single();

  if (!target || target.company_id !== profile.company_id) {
    return res.status(403).json({ error: 'Usuário não pertence à sua empresa' });
  }

  // Valida role contra lista permitida
  const ALLOWED_ROLES = ['admin', 'manager', 'seller'];
  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  // Atualiza email/senha no Auth se fornecidos
  if (email || password) {
    const updates = {};
    if (email) updates.email = email;
    if (password) updates.password = password;
    const { error } = await admin.auth.admin.updateUserById(userId, updates);
    if (error) return res.status(400).json({ error: error.message });
  }

  // Atualiza perfil
  const profileUpdates = {};
  if (name) profileUpdates.name = name;
  if (role) profileUpdates.role = role;
  if (email) profileUpdates.email = email;

  if (Object.keys(profileUpdates).length > 0) {
    await admin.from('user_profiles').update(profileUpdates).eq('id', userId);
  }

  return res.status(200).json({ ok: true });
}
