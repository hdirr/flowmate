import { supabase } from './supabase';

export const ROLE_LABELS = {
  admin:   { label: 'Admin',    color: '#6366f1', desc: 'Acesso total ao sistema' },
  manager: { label: 'Gerente',  color: '#3b82f6', desc: 'Gerencia leads e equipe, sem configurações' },
  seller:  { label: 'Vendedor', color: '#10b981', desc: 'Acessa apenas seus próprios leads' },
};

export const DEFAULT_PERMISSIONS = {
  admin: {
    pipeline:    { view_all: true,  view_own: true,  create: true,  edit: true,  remove: true  },
    contacts:    { view_all: true,  view_own: true,  create: true,  edit: true,  remove: true  },
    chats:       { view_all: true,  view_own: true,  send: true                                },
    automations: { view: true,  create: true,  edit: true,  remove: true,  execute: true       },
    import:      { access: true                                                                 },
    users:       { view: true,  create: true,  edit: true,  remove: true                      },
    settings:    { access: true                                                                 },
  },
  manager: {
    pipeline:    { view_all: true,  view_own: true,  create: true,  edit: true,  remove: false },
    contacts:    { view_all: true,  view_own: true,  create: true,  edit: true,  remove: false },
    chats:       { view_all: true,  view_own: true,  send: true                                },
    automations: { view: true,  create: true,  edit: true,  remove: false, execute: true       },
    import:      { access: true                                                                 },
    users:       { view: true,  create: false, edit: false, remove: false                      },
    settings:    { access: false                                                                },
  },
  seller: {
    pipeline:    { view_all: false, view_own: true,  create: true,  edit: true,  remove: false },
    contacts:    { view_all: false, view_own: true,  create: true,  edit: true,  remove: false },
    chats:       { view_all: false, view_own: true,  send: true                                },
    automations: { view: false, create: false, edit: false, remove: false, execute: false      },
    import:      { access: false                                                                },
    users:       { view: false, create: false, edit: false, remove: false                      },
    settings:    { access: false                                                                },
  },
};

// Cache da sessão em memória (evita re-fetches desnecessários)
let _session = null;
let _profile  = null;
let _perms    = null;
let _company  = null;

export const auth = {
  // Inicializa sessão a partir do Supabase (chame no boot da app)
  init: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { _session = null; _profile = null; _perms = null; return null; }

    _session = session;
    await auth._loadProfile(session.user.id);
    return _session;
  },

  _loadProfile: async (userId) => {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    _profile = profile;

    if (profile) {
      // Carrega a assinatura da empresa (trava de acesso)
      const { data: company } = await supabase
        .from('companies')
        .select('id, name, subscription_status, plan_level, plan_tier, plan_cycle, line_cap')
        .eq('id', profile.company_id)
        .single();
      _company = company || null;
    }

    if (profile) {
      const { data: permsRows } = await supabase
        .from('role_permissions')
        .select('module, action, enabled')
        .eq('company_id', profile.company_id)
        .eq('role', profile.role);

      if (permsRows && permsRows.length > 0) {
        // Monta objeto de permissões a partir das rows do banco
        const perms = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS[profile.role] || {}));
        permsRows.forEach(row => {
          if (!perms[row.module]) perms[row.module] = {};
          perms[row.module][row.action] = row.enabled;
        });
        _perms = perms;
      } else {
        _perms = DEFAULT_PERMISSIONS[profile.role] || {};
      }
    }
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    _session = data.session;
    await auth._loadProfile(data.user.id);
    return { session: _session };
  },

  // Cadastro self-service. Reusa o Supabase Auth existente. A empresa (tenant)
  // é criada depois, no Onboarding (RPC register_company), quando o usuário
  // entra sem company_id.
  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };

    // Se a confirmação de e-mail estiver desligada no projeto, já vem sessão.
    if (data.session) {
      _session = data.session;
      await auth._loadProfile(data.user.id);
      return { session: _session };
    }
    // Confirmação de e-mail ligada: sem sessão até o usuário confirmar.
    return { needsConfirmation: true };
  },

  logout: async () => {
    await supabase.auth.signOut();
    _session = null; _profile = null; _perms = null; _company = null;
  },

  session: () => _session,
  profile: () => _profile,
  company: () => _company,

  // Trava de acesso: a ferramenta só abre com assinatura ativa.
  // Falha-aberto quando o status é desconhecido (pré-migração ou empresa não carregou),
  // pra não trancar clientes existentes por engano. Só bloqueia status explícito não-ativo.
  subscriptionActive: () => {
    const s = _company?.subscription_status;
    if (s === undefined || s === null) return true;
    return s === 'active';
  },
  reloadCompany: async () => {
    if (!_profile?.company_id) return null;
    const { data } = await supabase.from('companies')
      .select('id, name, subscription_status, plan_level, plan_tier, plan_cycle, line_cap')
      .eq('id', _profile.company_id).single();
    _company = data || null;
    return _company;
  },

  can: (module, action) => {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true; // admin tem tudo
    return _perms?.[module]?.[action] ?? false;
  },

  isAdmin:   () => _profile?.role === 'admin',
  isPrimary: () => _profile?.is_primary === true,

  currentUserId:   () => _session?.user?.id || null,
  currentCompanyId: () => _profile?.company_id || null,
};

export const userStore = {
  list: async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.users || [];
  },

  create: async ({ name, email, password, role }) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'create', name, email, password, role }),
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Erro ao criar usuário' };
    return { user: data.user };
  },

  update: async (userId, { name, role, email, password }) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'update', userId, name, role, email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Erro ao atualizar usuário' };
    return { ok: true };
  },

  remove: async (id) => {
    const { data: profile } = await supabase.from('user_profiles').select('is_primary').eq('id', id).single();
    if (profile?.is_primary) return { error: 'Não é possível remover o administrador primário.' };
    await supabase.from('user_profiles').delete().eq('id', id);
    return {};
  },

  toggleActive: async (id) => {
    const { data } = await supabase.from('user_profiles').select('active, is_primary').eq('id', id).single();
    if (data?.is_primary) return;
    await supabase.from('user_profiles').update({ active: !data.active }).eq('id', id);
  },
};

export const permissionsStore = {
  get: () => _perms || DEFAULT_PERMISSIONS[_profile?.role] || {},

  set: async (role, module, action, value) => {
    const companyId = auth.currentCompanyId();
    await supabase.from('role_permissions').upsert({
      company_id: companyId, role, module, action, enabled: value,
    }, { onConflict: 'company_id,role,module,action' });

    // Atualiza cache local se for o papel do usuário atual
    if (_profile?.role === role && _perms) {
      if (!_perms[module]) _perms[module] = {};
      _perms[module][action] = value;
    }
  },

  reset: async (role) => {
    const companyId = auth.currentCompanyId();
    await supabase.from('role_permissions').delete()
      .eq('company_id', companyId).eq('role', role);
    if (_profile?.role === role) _perms = DEFAULT_PERMISSIONS[role];
  },
};
