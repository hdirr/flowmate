import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, password, role } = req.body;

  // Verifica se quem chamou é admin
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

  // Validações de entrada
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }
  const ALLOWED_ROLES = ['admin', 'manager', 'seller'];
  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  // company_id vem SEMPRE do admin autenticado, nunca do corpo da requisição
  const company_id = profile.company_id;

  // Cria o usuário com service role (seguro, roda no servidor)
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: authData, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) return res.status(400).json({ error: error.message });

  const { error: profileError } = await admin.from('user_profiles').insert({
    id: authData.user.id, company_id, name, role: role || 'seller', email,
    is_primary: false, active: true,
  });
  if (profileError) return res.status(400).json({ error: profileError.message });

  return res.status(200).json({ user: authData.user });
}
