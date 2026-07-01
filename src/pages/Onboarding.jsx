import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Building2, ArrowRight, LogOut } from 'lucide-react';

export default function Onboarding({ onDone, onLogout }) {
  const [companyName, setCompanyName] = useState('');
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!companyName.trim() || !userName.trim()) return;
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sessão expirada. Faça login novamente.'); setLoading(false); return; }

    const { error: fnError } = await supabase.rpc('register_company', {
      p_company_name: companyName.trim(),
      p_user_id: user.id,
      p_user_name: userName.trim(),
    });

    if (fnError) {
      // Se perfil já existe, apenas avança
      if (fnError.message?.includes('duplicate key') || fnError.message?.includes('user_profiles_pkey')) {
        onDone();
        return;
      }
      setError(fnError.message);
      setLoading(false);
      return;
    }
    onDone();
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Bem-vindo ao FlowMate</h1>
          <p className="text-gray-500 text-sm mt-1">Configure sua empresa para começar</p>
          <button onClick={onLogout} className="mt-3 text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 mx-auto transition-colors">
            <LogOut className="w-3 h-3" /> Sair da conta
          </button>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">
                Nome da empresa
              </label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                placeholder="Ex: Minha Empresa Ltda"
                required autoFocus
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-600" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">
                Seu nome
              </label>
              <input value={userName} onChange={e => setUserName(e.target.value)}
                placeholder="Nome completo"
                required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-600" />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || !companyName.trim() || !userName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors mt-2">
              {loading
                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <><ArrowRight className="w-4 h-4" /> Criar empresa e entrar</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
