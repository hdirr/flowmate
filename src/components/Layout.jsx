import Sidebar from './Sidebar';

export default function Layout({ children, session, profile, onLogout }) {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar session={session} profile={profile} onLogout={onLogout} />
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>
    </div>
  );
}
