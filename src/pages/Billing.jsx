import { useState } from 'react';
import { auth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { LEVELS, TIERS, monthlyPrice, annualMonthly, formatBRL } from '../lib/pricing';
import { CreditCard, LogOut, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react';

// Trava dura: sem assinatura ativa, a ferramenta não abre. Esta tela conduz ao
// checkout hospedado da Asaas.
export default function Billing({ onLogout, onActivated }) {
  const company = auth.company();
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const level = LEVELS.find(l => l.id === company?.plan_level);
  const tier = TIERS.find(t => t.id === company?.plan_tier);
  const cycle = company?.plan_cycle || 'mensal';
  const annual = cycle === 'anual';
  const price = level && tier
    ? (annual ? annualMonthly(level.id, tier.id) : monthlyPrice(level.id, tier.id))
    : null;

  const pastDue = company?.subscription_status === 'past_due';

  async function pay() {
    setError('');
    if (!cpfCnpj.trim()) { setError('Informe seu CPF ou CNPJ para a nota fiscal.'); return; }
    setLoading(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cpfCnpj: cpfCnpj.replace(/\D/g, '') }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      setError(data.error === 'gateway_nao_configurado'
        ? 'Pagamento ainda não está configurado. Fale com o suporte.'
        : (data.error || 'Não foi possível iniciar o pagamento.'));
      setLoading(false);
      return;
    }
    // Vai pro checkout hospedado da Asaas
    window.location.href = data.url;
  }

  async function recheck() {
    setChecking(true);
    await auth.reloadCompany();
    setChecking(false);
    if (auth.subscriptionActive()) onActivated();
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {pastDue ? 'Pagamento pendente' : 'Ative sua assinatura'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {pastDue
              ? 'Regularize o pagamento para reabrir o FlowMate.'
              : 'Finalize o pagamento para liberar o FlowMate.'}
          </p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl">
          {/* Resumo do plano */}
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-800">
            <div>
              <p className="text-white font-semibold">{level ? level.name : 'Plano'}</p>
              <p className="text-xs text-gray-500">
                {tier ? tier.label : '—'} · {annual ? 'anual' : 'mensal'}
              </p>
            </div>
            <div className="text-right">
              {price != null ? (
                <>
                  <span className="text-2xl font-bold text-white">{formatBRL(price)}</span>
                  <span className="text-gray-500 text-sm">/mês</span>
                </>
              ) : <span className="text-gray-400">—</span>}
            </div>
          </div>

          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">CPF ou CNPJ</label>
          <input value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
            placeholder="Para a nota fiscal"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-blue-500 placeholder-gray-600" />

          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg mb-4">{error}</div>}

          <button onClick={pay} disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {loading ? 'Abrindo checkout...' : 'Pagar com PIX, boleto ou cartão'}
          </button>

          <p className="text-[11px] text-gray-600 text-center mt-3">
            Pagamento processado pela Asaas. O cartão nunca passa pelo FlowMate.
          </p>

          <button onClick={recheck} disabled={checking}
            className="w-full mt-4 text-sm text-gray-400 hover:text-white flex items-center justify-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Já paguei — verificar
          </button>
        </div>

        <button onClick={onLogout} className="mt-4 mx-auto text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors">
          <LogOut className="w-3 h-3" /> Sair da conta
        </button>
      </div>
    </div>
  );
}
