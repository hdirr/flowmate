import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import Billing from './pages/Billing';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import Contacts from './pages/Contacts';
import Chats from './pages/Chats';
import Automations from './pages/Automations';
import Import from './pages/Import';
import Users from './pages/Users';
import Settings from './pages/Settings';
import { auth } from './lib/auth';
import { supabase } from './lib/supabase';

export default function App() {
  const [status, setStatus] = useState('loading'); // loading | unauthenticated | onboarding | ready
  const [profile, setProfile] = useState(null);
  const [gateKey, setGateKey] = useState(0); // força reavaliar a trava de assinatura

  useEffect(() => {
    // Inicializa sessão ao carregar
    auth.init().then(session => {
      if (!session) { setStatus('unauthenticated'); return; }
      const p = auth.profile();
      if (!p || !p.company_id) { setStatus('onboarding'); return; }
      setProfile(p);
      setStatus('ready');
    });

    // Escuta mudanças de auth (login/logout em outra aba)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') { setStatus('unauthenticated'); setProfile(null); }
      if (event === 'SIGNED_IN') {
        await auth.init();
        const p = auth.profile();
        if (!p || !p.company_id) { setStatus('onboarding'); return; }
        setProfile(p);
        setStatus('ready');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin() {
    const p = auth.profile();
    if (!p) { setStatus('onboarding'); return; }
    setProfile(p);
    setStatus('ready');
  }

  async function handleOnboardingDone() {
    await auth.init();
    setProfile(auth.profile());
    setStatus('ready');
  }

  async function handleLogout() {
    await auth.logout();
    setProfile(null);
    setStatus('unauthenticated');
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">F</span>
          </div>
          <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Visitante anônimo: site público (landing / entrar / criar conta)
  if (status === 'unauthenticated') {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/entrar"      element={<Login onLogin={handleLogin} />} />
          <Route path="/criar-conta" element={<SignUp onSignedIn={handleLogin} />} />
          <Route path="/"            element={<Landing />} />
          <Route path="*"            element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    );
  }
  if (status === 'onboarding')     return <Onboarding onDone={handleOnboardingDone} onLogout={handleLogout} />;

  // Trava dura: sem assinatura ativa, a ferramenta não abre.
  if (status === 'ready' && !auth.subscriptionActive()) {
    return <Billing key={gateKey} onLogout={handleLogout} onActivated={() => setGateKey(k => k + 1)} />;
  }

  return (
    <BrowserRouter>
      <Layout session={auth.session()} profile={profile} onLogout={handleLogout}>
        <Routes>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/pipeline"      element={<Pipeline />} />
          <Route path="/contatos"      element={<Contacts />} />
          <Route path="/chats"         element={<Chats />} />
          <Route path="/automacoes"    element={<Automations />} />
          <Route path="/importar"      element={<Import />} />
          <Route path="/usuarios"      element={<Users />} />
          <Route path="/configuracoes" element={<Settings />} />
          <Route path="*"              element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
