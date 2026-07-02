import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';

export default function Layout({ children, session, profile, onLogout }) {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar session={session} profile={profile} onLogout={onLogout} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Barra superior */}
        <header className="h-14 shrink-0 bg-white border-b border-gray-100 flex items-center justify-end px-4 md:px-6 gap-3">
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
