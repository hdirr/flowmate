import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check, Zap, MessageCircle, Webhook, ShieldCheck, ArrowRight, Sparkles,
} from 'lucide-react';
import {
  PUBLISHED, AVAILABLE_TIERS, LEVELS, monthlyPrice, annualMonthly, formatBRL,
} from '../lib/pricing';

export default function Landing() {
  const tierId = AVAILABLE_TIERS[0]; // um plano por CRM (um número). Multi-linha vem depois.
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Top bar ── */}
      <header className="max-w-6xl mx-auto flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold">F</div>
          <span className="font-bold text-lg">FlowMate</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/entrar" className="text-sm text-gray-300 hover:text-white px-4 py-2">Entrar</Link>
          <a href="#planos" className="text-sm font-semibold bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg transition-colors">
            Criar conta
          </a>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-3xl mx-auto text-center px-5 pt-16 pb-10">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1 mb-5">
          <Sparkles className="w-3.5 h-3.5" /> CRM de WhatsApp com automação de verdade
        </div>
        <h1 className="text-4xl md:text-5xl font-bold leading-tight">
          Seu WhatsApp vira um <span className="text-blue-400">CRM completo</span> — e conversa com o seu n8n.
        </h1>
        <p className="text-gray-400 text-lg mt-5">
          Inbox unificada, funil de vendas e API aberta pra você trazer sua própria automação.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <a href="#planos" className="bg-blue-600 hover:bg-blue-500 font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition-colors">
            Escolher meu plano <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* ── Diferenciais (só o que é verdade hoje) ── */}
      <section className="max-w-5xl mx-auto grid md:grid-cols-3 gap-4 px-5 py-10">
        {[
          { icon: MessageCircle, t: 'Inbox + Funil', d: 'Todas as conversas num lugar, com pipeline visual e múltiplos funis.' },
          { icon: Webhook, t: 'Traga sua automação', d: 'API e webhooks pra ligar seu n8n, Make ou Zapier. Kommo não tem.' },
          { icon: ShieldCheck, t: 'Sem fidelidade', d: 'Cancele quando quiser. Nada de 6 meses adiantado.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="w-9 h-9 bg-blue-500/15 text-blue-300 rounded-lg flex items-center justify-center mb-3">
              <Icon className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">{t}</h3>
            <p className="text-sm text-gray-400 mt-1">{d}</p>
          </div>
        ))}
      </section>

      {/* ── Planos ── */}
      <section id="planos" className="max-w-5xl mx-auto px-5 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold">Escolha seu plano</h2>
          <p className="text-gray-400 mt-2">
            Conecte seu número de WhatsApp e escolha o nível de recurso.
          </p>
        </div>

        {!PUBLISHED && (
          <div className="max-w-xl mx-auto mb-8 text-center text-sm bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-4 py-2.5">
            ⚠️ Prévia — preços ainda não finais. Não representa oferta comercial.
          </div>
        )}

        {/* Toggle mensal/anual */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className={`text-sm ${!annual ? 'text-white' : 'text-gray-500'}`}>Mensal</span>
          <button onClick={() => setAnnual(a => !a)}
            className="relative w-12 h-6 rounded-full bg-gray-700 transition-colors">
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-blue-500 rounded-full transition-transform ${annual ? 'translate-x-6' : ''}`} />
          </button>
          <span className={`text-sm flex items-center gap-1.5 ${annual ? 'text-white' : 'text-gray-500'}`}>
            Anual <span className="text-xs bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full">-23%</span>
          </span>
        </div>

        {/* Cards — 3 níveis */}
        <div className="grid md:grid-cols-3 gap-4 items-stretch">
            {LEVELS.map(level => {
              const m = monthlyPrice(level.id, tierId);
              const priceShown = annual ? annualMonthly(level.id, tierId) : m;
              return (
                <div key={level.id}
                  className={`relative rounded-2xl p-6 flex flex-col border
                    ${level.highlight ? 'bg-gray-900 border-blue-500 shadow-lg shadow-blue-500/10' : 'bg-gray-900 border-gray-800'}`}>
                  {level.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold bg-blue-600 px-3 py-1 rounded-full flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Mais popular
                    </span>
                  )}
                  <h3 className="text-lg font-bold">{level.name}</h3>
                  <p className="text-sm text-gray-400">{level.tagline}</p>

                  <div className="mt-4 mb-1">
                    {priceShown != null ? (
                      <>
                        <span className="text-3xl font-bold">{formatBRL(priceShown)}</span>
                        <span className="text-gray-500 text-sm">/mês</span>
                      </>
                    ) : (
                      <span className="text-2xl font-bold text-gray-400">—</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-5 h-4">
                    {annual && priceShown != null && `cobrado anualmente (${formatBRL(annualMonthly(level.id, tierId) * 12)}/ano)`}
                  </p>

                  <ul className="space-y-2.5 flex-1">
                    {level.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                        <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>

                  <Link to={`/criar-conta?plan=${level.id}&tier=${tierId}&cycle=${annual ? 'anual' : 'mensal'}`}
                    className={`mt-6 w-full text-center font-semibold py-2.5 rounded-xl text-sm transition-colors
                      ${level.highlight ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-800 hover:bg-gray-700'}`}>
                    Assinar {level.name}
                  </Link>
                </div>
              );
            })}
        </div>
      </section>

      {/* ── Rodapé ── */}
      <footer className="border-t border-gray-900 mt-10">
        <div className="max-w-5xl mx-auto px-5 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} FlowMate</span>
          <div className="flex items-center gap-4">
            <Link to="/entrar" className="hover:text-gray-300">Entrar</Link>
            <a href="#planos" className="hover:text-gray-300">Planos</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
