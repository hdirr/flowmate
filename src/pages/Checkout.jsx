import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LEVELS, monthlyPrice, annualMonthly, annualTotal, formatBRL } from '../lib/pricing';
import { CreditCard, Loader2, ArrowLeft, Check, Lock, ShieldCheck, Zap } from 'lucide-react';

// Pagamento ANTES da conta. Coleta o mínimo (nome + email + CPF) e leva ao checkout da Asaas.
export default function Checkout() {
  const [params] = useSearchParams();
  const level = LEVELS.find(l => l.id === params.get('plan')) || LEVELS[1]; // default Pro
  const cycle = params.get('cycle') === 'anual' ? 'anual' : 'mensal';
  const annual = cycle === 'anual';
  const price = annual ? annualMonthly(level.id, 't1') : monthlyPrice(level.id, 't1');

  const [form, setForm] = useState({ name: '', email: '', cpfCnpj: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function goToPayment(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim() || !form.cpfCnpj.trim()) {
      setError('Preencha todos os campos.'); return;
    }
    setLoading(true);
    const payTab = window.open('', '_blank'); // abre já no clique (evita bloqueio de pop-up)
    const res = await fetch('/api/billing/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_level: level.id, plan_tier: 't1', plan_cycle: cycle,
        name: form.name.trim(), email: form.email.trim(), cpfCnpj: form.cpfCnpj.replace(/\D/g, ''),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      if (payTab) payTab.close();
      setError(data.error === 'gateway_nao_configurado'
        ? 'Pagamento indisponível no momento. Tente novamente em instantes.'
        : 'Não foi possível iniciar o pagamento. Confira o CPF/CNPJ e tente de novo.');
      setLoading(false);
      return;
    }
    localStorage.setItem('flowmate:payUrl', data.url);
    if (payTab) payTab.location.href = data.url; else window.open(data.url, '_blank');
    window.location.href = `/ativar?token=${data.token}`;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="max-w-5xl mx-auto flex items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold">F</div>
          <span className="font-bold text-lg">FlowMate</span>
        </Link>
        <Link to="/" className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="max-w-5xl mx-auto px-5 pt-6 pb-16 grid md:grid-cols-2 gap-6 items-start">

        {/* ── Resumo do pedido ── */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 md:sticky md:top-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Resumo da assinatura</p>

          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold">FlowMate {level.name}</h2>
            {level.highlight && (
              <span className="text-[10px] font-semibold bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Popular
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mb-5">{level.tagline}</p>

          <div className="flex items-end gap-1 mb-1">
            <span className="text-4xl font-bold">{formatBRL(price)}</span>
            <span className="text-gray-500 mb-1">/mês</span>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            {annual
              ? `Plano anual — ${formatBRL(annualTotal(level.id, 't1'))} por ano (2 meses grátis)`
              : 'Plano mensal — sem fidelidade, cancele quando quiser'}
          </p>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 mb-2">Incluso:</p>
            <ul className="space-y-2">
              {level.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                  <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" /> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Dados + pagamento ── */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
          <h3 className="font-bold text-lg mb-1">Seus dados</h3>
          <p className="text-sm text-gray-500 mb-5">Você cria seu acesso logo após o pagamento.</p>

          <form onSubmit={goToPayment} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Nome completo</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Como no seu documento" required autoFocus
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">E-mail</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="seu@email.com" required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">CPF ou CNPJ</label>
              <input value={form.cpfCnpj} onChange={e => set('cpfCnpj', e.target.value)} placeholder="Para a nota fiscal" required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600" />
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors mt-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {loading ? 'Abrindo pagamento seguro...' : `Ir para o pagamento · ${formatBRL(price)}/mês`}
            </button>
          </form>

          <div className="flex items-center gap-2 mt-4 text-xs text-gray-500">
            <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
            Pagamento seguro processado pela Asaas. O cartão nunca passa pelo FlowMate.
          </div>

          <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-gray-800 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Cartão</span>
            <span>·</span>
            <span>PIX</span>
            <span>·</span>
            <span>Boleto</span>
          </div>

          <p className="text-xs text-gray-600 text-center mt-4">
            Já tem conta? <Link to="/entrar" className="text-blue-400 hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
