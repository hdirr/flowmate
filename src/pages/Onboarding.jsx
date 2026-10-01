import { useState } from 'react';
import { Building2, ArrowRight, LogOut } from 'lucide-react';

// Usuário logado sem empresa. A criação de empresa pelo navegador (RPC register_company)
// foi fechada no banco em 29/09/2026: empresa nova nasce no fluxo de pagamento.
// O arquivo fica para um futuro fluxo de convite.
export default function Onboarding({ onLogout }) {
  const [leaving, setLeaving] = useState(false);

  // /assinar só existe para visitante deslogado (App.jsx), então sai da conta antes.
  async function goToCheckout() {
    setLeaving(true);
    await onLogout();
    window.location.assign('/assinar');
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Bem-vindo ao FlowMate</h1>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-2xl space-y-4">
          <p className="text-gray-300 text-sm text-center leading-relaxed">
            Sua conta ainda não tem uma empresa ativa. Para usar o FlowMate, assine um plano.
          </p>

          <button onClick={goToCheckout} disabled={leaving}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
            <ArrowRight className="w-4 h-4" /> Assinar um plano
          </button>

          <button onClick={onLogout} disabled={leaving}
            className="w-full text-gray-400 hover:text-white text-sm flex items-center justify-center gap-1.5 py-2 transition-colors">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}
