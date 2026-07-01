import { useState } from 'react';
import { permissionsStore, ROLE_LABELS, DEFAULT_PERMISSIONS, auth } from '../lib/auth';
import { RotateCcw, ShieldCheck } from 'lucide-react';

const MODULES = {
  pipeline:    { label: 'Pipeline',    actions: { view_all: 'Ver todos', view_own: 'Ver próprios', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  contacts:    { label: 'Contatos',    actions: { view_all: 'Ver todos', view_own: 'Ver próprios', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  chats:       { label: 'Chats',       actions: { view_all: 'Ver todos', view_own: 'Ver próprios', send: 'Enviar mensagem' } },
  automations: { label: 'Automações',  actions: { view: 'Ver', create: 'Criar', edit: 'Editar', remove: 'Remover', execute: 'Executar' } },
  import:      { label: 'Importar',    actions: { access: 'Acessar' } },
  users:       { label: 'Usuários',    actions: { view: 'Ver', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  settings:    { label: 'Configurações', actions: { access: 'Acessar' } },
};

const ROLES = ['admin', 'manager', 'seller'];

export default function Settings() {
  const session = auth.session();
  const isAdmin = session?.role === 'admin';
  const [perms, setPerms] = useState(() => permissionsStore.get());
  const [activeRole, setActiveRole] = useState('manager');
  const [saved, setSaved] = useState(false);

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-gray-500 mt-16">
        <ShieldCheck className="w-10 h-10 text-gray-300" />
        <p className="font-medium">Sem permissão para acessar esta página.</p>
      </div>
    );
  }

  function toggle(module, action) {
    const current = perms[activeRole]?.[module]?.[action] ?? false;
    const updated = {
      ...perms,
      [activeRole]: {
        ...perms[activeRole],
        [module]: { ...perms[activeRole]?.[module], [action]: !current },
      },
    };
    setPerms(updated);
    permissionsStore.set(activeRole, module, action, !current);
    showSaved();
  }

  function reset() {
    if (!confirm(`Resetar permissões do ${ROLE_LABELS[activeRole].label} para o padrão?`)) return;
    permissionsStore.reset(activeRole);
    setPerms(permissionsStore.get());
    showSaved();
  }

  function showSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const roleInfo = ROLE_LABELS[activeRole];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure as permissões de cada papel no sistema</p>
      </div>

      {/* Role tabs */}
      <div className="flex gap-2 mb-6">
        {ROLES.map(r => {
          const rl = ROLE_LABELS[r];
          const active = r === activeRole;
          return (
            <button key={r} onClick={() => setActiveRole(r)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border
                ${active ? 'text-white border-transparent shadow' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              style={active ? { backgroundColor: rl.color, borderColor: rl.color } : {}}>
              {rl.label}
            </button>
          );
        })}
      </div>

      {/* Aviso admin */}
      {activeRole === 'admin' && (
        <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          Admins sempre têm acesso total ao sistema. Permissões não se aplicam a este papel.
        </div>
      )}

      {/* Tabela de permissões */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {Object.entries(MODULES).map(([modKey, mod], idx) => (
          <div key={modKey} className={`${idx > 0 ? 'border-t border-gray-100' : ''}`}>
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{mod.label}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {Object.entries(mod.actions).map(([actKey, actLabel]) => {
                const enabled = perms[activeRole]?.[modKey]?.[actKey] ?? false;
                const isAdminRole = activeRole === 'admin';
                return (
                  <div key={actKey} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-gray-600">{actLabel}</span>
                    <button
                      onClick={() => !isAdminRole && toggle(modKey, actKey)}
                      disabled={isAdminRole}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                        enabled || isAdminRole ? 'bg-blue-500' : 'bg-gray-200'
                      } ${isAdminRole ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                        ${enabled || isAdminRole ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4">
        <button onClick={reset} disabled={activeRole === 'admin'}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-default">
          <RotateCcw className="w-4 h-4" /> Restaurar padrão
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium animate-pulse">Salvo automaticamente ✓</span>
        )}
      </div>
    </div>
  );
}
