import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check, Zap, MessageCircle, KanbanSquare, Webhook, ShieldCheck,
  ArrowRight, Sparkles, X,
} from 'lucide-react';
import {
  PUBLISHED, TIERS, LEVELS, monthlyPrice, annualMonthly, formatBRL,
} from '../lib/pricing';

// WhatsApp do Agadir para o fluxo "16+" e contato (troque quando quiser)
const CONTACT_WHATSAPP = '553194008467';

export default function Landing() {
  const [tierId, setTierId] = useState('t1');
  const [annual, setAnnual] = useState(false);
  const tier = TIERS.find(t => t.id === tierId);
  const isCustom = !!tier?.contact;

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
          <h2 className="text-3xl font-bold">Escolha por linha</h2>
          <p className="text-gray-400 mt-2">
            Cada número de WhatsApp conectado é uma <b className="text-gray-200">linha</b>. Escolha a faixa e o nível de recurso.
          </p>
        </div>

        {!PUBLISHED && (
          <div className="max-w-xl mx-auto mb-8 text-center text-sm bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-4 py-2.5">
            ⚠️ Prévia — preços ainda não finais. Não representa oferta comercial.
          </div>
        )}

        {/* Seletor de faixa */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <span className="text-sm text-gray-500 mr-1">Quantas linhas?</span>
          {TIERS.map(t => (
            <button key={t.id} onClick={() => setTierId(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors
                ${tierId === t.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Toggle mensal/anual */}
        {!isCustom && (
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
        )}

        {/* Cards — 3 níveis da faixa escolhida, OU formulário 16+ */}
        {isCustom ? (
          <CustomContact />
        ) : (
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
        )}

        <p className="text-center text-xs text-gray-600 mt-6">
          A faixa define o teto de linhas (números de WhatsApp) que a conta pode conectar. Precisa de mais? É só subir de faixa.
        </p>
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

// Fluxo "16+": nunca vai pro checkout automático — abre triagem com o Agadir.
function CustomContact() {
  const [form, setForm] = useState({ name: '', company: '', lines: '', phone: '' });
  const msg = encodeURIComponent(
    `Olá! Quero o FlowMate para ${form.lines || '16+'} linhas.\n` +
    `Nome: ${form.name}\nEmpresa: ${form.company}\nWhatsApp: ${form.phone}`
  );
  const waLink = `https://wa.me/${CONTACT_WHATSAPP}?text=${msg}`;

  return (
    <div className="max-w-lg mx-auto bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h3 className="text-lg font-bold">Mais de 16 linhas? Vamos conversar.</h3>
      <p className="text-sm text-gray-400 mt-1 mb-5">
        Acima de 16 linhas montamos um plano sob medida. Preencha e a gente te chama.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <input placeholder="Seu nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        <input placeholder="Empresa" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        <input placeholder="Nº de linhas" value={form.lines} onChange={e => setForm(f => ({ ...f, lines: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        <input placeholder="Seu WhatsApp" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className="col-span-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
      </div>
      <a href={waLink} target="_blank" rel="noreferrer"
        className="mt-5 w-full inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 font-semibold py-2.5 rounded-xl text-sm transition-colors">
        <MessageCircle className="w-4 h-4" /> Falar com o time
      </a>
    </div>
  );
}
