import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../lib/auth';
import { LEVELS } from '../lib/pricing';
import { UserPlus, Eye, EyeOff, MailCheck, Check } from 'lucide-react';

// Cadastro self-service. Cria o usuário no Supabase Auth (reuso) e deixa o
// Onboarding criar a empresa (tenant) no primeiro acesso.
export default function SignUp({ onSignedIn }) {
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Plano escolhido na landing (?plan=&cycle=) — mostrado como confirmação
  const level = LEVELS.find(l => l.id === params.get('plan'));
  const tierId = params.get('tier') || 't1';
  const cycle = params.get('cycle');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { setError('A senha precisa de pelo menos 6 caracteres.'); return; }
    // Guarda o plano escolhido pra aplicar na empresa depois do onboarding
    if (level) {
      localStorage.setItem('flowmate:pendingPlan', JSON.stringify({
        plan_level: level.id, plan_tier: tierId, plan_cycle: cycle || 'mensal',
      }));
    }
    setLoading(true);
    const result = await auth.signUp(form.email.trim(), form.password);
    if (result.error) { setError(result.error); setLoading(false); return; }
    if (result.needsConfirmation) { setSent(true); setLoading(false); return; }
    onSignedIn(result.session); // sem confirmação de e-mail → já entra e cai no Onboarding
  }

  if (sent) {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-12 h-12 bg-green-500/15 text-green-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MailCheck className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Confirme seu e-mail</h2>
          <p className="text-sm text-gray-400 mt-2">
            Enviamos um link de confirmação para <b className="text-gray-200">{form.email}</b>.
            Confirme e depois <Link to="/entrar" className="text-blue-400 hover:underline">entre na sua conta</Link>.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {level && (
        <div className="mb-4 flex items-center gap-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5">
          <Check className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-sm text-gray-300">
            Plano <b className="text-white">{level.name}</b>
            {cycle && <> · {cycle}</>}
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">E-mail</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="seu@email.com" required autoFocus
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Senha</label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="mínimo 6 caracteres" required
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            <button type="button" onClick={() => setShowPass(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">{error}</div>}

        <button type="submit" disabled={loading || !form.email || !form.password}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors mt-2">
          {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><UserPlus className="w-4 h-4" /> Criar conta</>}
        </button>
      </form>

      <p className="text-xs text-gray-600 text-center mt-4">
        Já tem conta? <Link to="/entrar" className="text-blue-400 hover:underline">Entrar</Link>
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex flex-col items-center">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <span className="text-white font-bold text-xl">F</span>
            </div>
            <h1 className="text-2xl font-bold text-white">FlowMate</h1>
          </Link>
          <p className="text-gray-500 text-sm mt-1">Crie sua conta em segundos</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}
