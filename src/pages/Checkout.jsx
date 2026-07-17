import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LEVELS, monthlyPrice, annualMonthly, formatBRL } from '../lib/pricing';
import { CreditCard, Loader2, ArrowLeft, Check } from 'lucide-react';

// Pagamento ANTES da conta. Coleta o mínimo (email + CPF) e leva ao checkout da Asaas.
export default function Checkout() {
  const [params] = useSearchParams();
  const level = LEVELS.find(l => l.id === params.get('plan')) || LEVELS[1]; // default Pro
  const cycle = params.get('cycle') === 'anual' ? 'anual' : 'mensal';
  const annual = cycle === 'anual';
  const price = annual ? annualMonthly(level.id, 't1') : monthlyPrice(level.id, 't1');

  const [email, setEmail] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function goToPayment(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !cpfCnpj.trim()) { setError('Preencha e-mail e CPF/CNPJ.'); return; }
    setLoading(true);
    const res = await fetch('/api/billing/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_level: level.id, plan_tier: 't1', plan_cycle: cycle,
        email: email.trim(), cpfCnpj: cpfCnpj.replace(/\D/g, ''),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      setError(data.error === 'gateway_nao_configurado'
        ? 'Pagamento ainda não está configurado. Tente novamente em instantes.'
        : 'Não foi possível iniciar o pagamento. Confira o CPF/CNPJ e tente de novo.');
      setLoading(false);
      return;
    }
    window.location.href = data.url; // checkout hospedado da Asaas
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-bold text-xl">F</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Assinar {level.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Você cria seu acesso logo após o pagamento.</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-800">
            <div>
              <p className="text-white font-semibold">{level.name}</p>
              <p className="text-xs text-gray-500">{annual ? 'anual' : 'mensal'}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-white">{formatBRL(price)}</span>
              <span className="text-gray-500 text-sm">/mês</span>
            </div>
          </div>

          <form onSubmit={goToPayment} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">E-mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">CPF ou CNPJ</label>
              <input value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)} placeholder="Para a nota fiscal" required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {loading ? 'Abrindo pagamento...' : 'Ir para o pagamento'}
            </button>
          </form>

          <div className="mt-4 space-y-1.5">
            {['PIX, boleto ou cartão', 'Sem fidelidade — cancele quando quiser', 'Acesso liberado assim que o pagamento confirmar'].map(t => (
              <p key={t} className="text-xs text-gray-500 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" /> {t}
              </p>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-gray-600 text-center mt-4">
          Pagamento processado pela Asaas. O cartão nunca passa pelo FlowMate.
        </p>
        <p className="text-xs text-gray-600 text-center mt-2">
          Já tem conta? <Link to="/entrar" className="text-blue-400 hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
