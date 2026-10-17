// Permissões por papel — FONTE ÚNICA (antes só em src/lib/auth.js). A tela importa daqui; o
// servidor usa para conferir o que a tela já esconde (rotas da tela que gravam). Sem
// dependências de Node: este arquivo também é importado pelo navegador.
//
// Regra (igual à da tela): admin pode tudo; os demais papéis usam as linhas de
// role_permissions da empresa e, para o que não tiver linha, o padrão abaixo.
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

// rows: linhas de role_permissions do papel ({ module, action, enabled }).
export function permissionChecker(role, rows) {
  const perms = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS[role] || {}));
  for (const r of rows || []) {
    if (!perms[r.module]) perms[r.module] = {};
    perms[r.module][r.action] = r.enabled;
  }
  return (module, action) => role === 'admin' || perms?.[module]?.[action] === true;
}
