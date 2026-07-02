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

  logout: async () => {
    await supabase.auth.signOut();
    _session = null; _profile = null; _perms = null;
  },

  session: () => _session,
  profile: () => _profile,

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
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('company_id', auth.currentCompanyId())
      .order('name');
    return data || [];
  },

  create: async ({ name, email, password, role }) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const res = await fetch('https://fwtnzxehfaqeklueojkp.supabase.co/functions/v1/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name, email, password, role,
        company_id: auth.currentCompanyId(),
      }),
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Erro ao criar usuário' };
    return { user: data.user };
  },

  update: async (id, data) => {
    await supabase.from('user_profiles').update(data).eq('id', id);
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
