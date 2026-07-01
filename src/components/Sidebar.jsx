import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, KanbanSquare, MessageCircle, Bot, FileUp, UserCog, Settings, LogOut, Crown } from 'lucide-react';
import { auth, ROLE_LABELS } from '../lib/auth';

const mainLinks = [
  { to: '/',           icon: LayoutDashboard, label: 'Início' },
  { to: '/pipeline',   icon: KanbanSquare,    label: 'Pipeline' },
  { to: '/contatos',   icon: Users,           label: 'Contatos' },
  { to: '/chats',      icon: MessageCircle,   label: 'Chats' },
  { to: '/automacoes', icon: Bot,             label: 'Automações',  perm: ['automations', 'view'] },
  { to: '/importar',   icon: FileUp,          label: 'Importar',    perm: ['import', 'access'] },
];

const adminLinks = [
  { to: '/usuarios',      icon: UserCog,  label: 'Usuários',        perm: ['users', 'view'] },
  { to: '/configuracoes', icon: Settings, label: 'Configurações',   perm: ['settings', 'access'] },
];

export default function Sidebar({ session, profile, onLogout }) {
  const roleKey = profile?.role || session?.user?.role || 'seller';
  const role = ROLE_LABELS[roleKey] || { label: roleKey, color: '#888' };
  const displayName = profile?.name || session?.user?.email || '—';
  const isPrimary = profile?.is_primary;

  function visible(link) {
    if (!link.perm) return true;
    return auth.can(link.perm[0], link.perm[1]);
  }

  const visibleMain = mainLinks.filter(visible);
  const visibleAdmin = adminLinks.filter(visible);

  function LinkItem({ to, icon: Icon, label, mobile }) {
    if (mobile) {
      return (
        <NavLink to={to} end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg flex-1 transition-colors
             ${isActive ? 'text-blue-400' : 'text-gray-500'}`}>
          <Icon className="w-5 h-5" />
          <span className="text-[10px] leading-tight">{label}</span>
        </NavLink>
      );
    }
    return (
      <NavLink to={to} end={to === '/'}
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 text-sm transition-colors
           ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
        <Icon className="w-5 h-5 shrink-0" />
        <span>{label}</span>
      </NavLink>
    );
  }

  // Links visíveis no mobile (máx 5 para caber)
  const mobileLinks = [...visibleMain, ...visibleAdmin].slice(0, 5);

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-52 bg-gray-900 text-white flex-col py-4 shrink-0">
        <div className="px-4 mb-5">
          <span className="text-lg font-bold text-blue-400">FlowMate</span>
        </div>

        <div className="flex flex-col gap-1 flex-1">
          {visibleMain.map(l => <LinkItem key={l.to} {...l} />)}

          {visibleAdmin.length > 0 && (
            <>
              <div className="mx-4 my-2 border-t border-gray-800" />
              {visibleAdmin.map(l => <LinkItem key={l.to} {...l} />)}
            </>
          )}
        </div>

        {/* User info + logout */}
        <div className="mx-2 mt-2 border-t border-gray-800 pt-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: role.color }}>
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate flex items-center gap-1">
                {displayName}
                {isPrimary && <Crown className="w-3 h-3 text-yellow-400" />}
              </p>
              <p className="text-[10px] text-gray-500">{role.label}</p>
            </div>
            <button onClick={onLogout} title="Sair"
              className="text-gray-600 hover:text-red-400 transition-colors shrink-0">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Bottom nav mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex items-center justify-around px-1 py-1">
        {mobileLinks.map(l => <LinkItem key={l.to} {...l} mobile />)}
      </nav>
    </>
  );
}
