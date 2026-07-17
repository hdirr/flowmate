import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { auth } from '../lib/auth';
import { Loader2, ShieldCheck, Eye, EyeOff, Clock } from 'lucide-react';

// Volta do Asaas com ?token=. Espera o pagamento confirmar, então cria a conta
// (sem confirmação de e-mail) e entra direto no dashboard.
export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [state, setState] = useState('checking'); // checking | waiting | form | activating | done
  const [email, setEmail] = useState('');
  const [form, setForm] = useState({ companyName: '', userName: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const payUrl = typeof window !== 'undefined' ? localStorage.getItem('flowmate:payUrl') : null;

  const check = useCallback(async () => {
    if (!token) { setState('notoken'); return; }
    const res = await fetch(`/api/billing/status?token=${encodeURIComponent(token)}`);
    if (!res.ok) { setState('waiting'); return; }
    const data = await res.json();
    setEmail(data.email || '');
    if (data.activated) { setState('activated'); return; }
    setState(data.status === 'paid' ? 'form' : 'waiting');
  }, [token]);

  useEffect(() => { check(); }, [check]);

  // Enquanto espera o pagamento, repete a checagem
  useEffect(() => {
    if (state !== 'waiting' && state !== 'checking') return;
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [state, check]);

  async function activate(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { setError('A senha precisa de pelo menos 6 caracteres.'); return; }
    setState('activating');
    const res = await fetch('/api/billing/activate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...form }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error === 'pagamento_pendente' ? 'O pagamento ainda não foi confirmado.' : (data.error || 'Erro ao criar a conta.'));
      setState('form');
      return;
    }
    // Loga e entra direto no dashboard
    await auth.login(email, form.password);
    window.location.href = '/';
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {state === 'form' || state === 'activating' ? 'Crie seu acesso' : 'Confirmando pagamento'}
          </h1>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl">
          {(state === 'checking' || state === 'waiting') && (
            <div className="text-center py-4">
              <Clock className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <p className="text-gray-300 text-sm">Aguardando a confirmação do pagamento…</p>
              <p className="text-gray-500 text-xs mt-2">
                PIX e cartão confirmam em minutos. Boleto pode levar até 3 dias úteis.
                Esta tela atualiza sozinha — pode deixá-la aberta.
              </p>
              <div className="flex justify-center mt-4"><Loader2 className="w-5 h-5 animate-spin text-gray-600" /></div>
              {payUrl && (
                <a href={payUrl} target="_blank" rel="noreferrer"
                  className="inline-block mt-4 text-sm text-blue-400 hover:underline">
                  Não abriu? Abrir o pagamento
                </a>
              )}
            </div>
          )}

          {(state === 'form' || state === 'activating') && (
            <form onSubmit={activate} className="space-y-3">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 text-sm text-green-400 mb-1">
                ✓ Pagamento confirmado — {email}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Nome da empresa</label>
                <input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} required autoFocus
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" placeholder="Ex: Minha Empresa" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Seu nome</label>
                <input value={form.userName} onChange={e => setForm(f => ({ ...f, userName: e.target.value }))} required
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" placeholder="Nome completo" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Crie uma senha</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" placeholder="mínimo 6 caracteres" />
                  <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">{error}</div>}

              <button type="submit" disabled={state === 'activating'}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors mt-1">
                {state === 'activating' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {state === 'activating' ? 'Criando seu acesso...' : 'Acessar o FlowMate'}
              </button>
            </form>
          )}

          {state === 'activated' && (
            <div className="text-center py-4">
              <p className="text-gray-300 text-sm">Esta conta já foi ativada.</p>
              <Link to="/entrar" className="inline-block mt-3 text-blue-400 hover:underline text-sm">Entrar</Link>
            </div>
          )}

          {state === 'notoken' && (
            <div className="text-center py-4">
              <p className="text-gray-300 text-sm">Link inválido.</p>
              <Link to="/" className="inline-block mt-3 text-blue-400 hover:underline text-sm">Voltar aos planos</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
