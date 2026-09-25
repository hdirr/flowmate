import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, MessageCircle, Sparkles, X, ChevronDown, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/store';
import { auth } from '../lib/auth';

// Mesma forma canônica do sino: só dígitos, últimos 11 (DDD+número), ignora o 55.
function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 11 ? d.slice(-11) : d;
}
function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000;
  return new Date(ts).getTime();
}
function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// "Novos contatos chegando" = quem mandou WhatsApp e ainda NÃO está no CRM
// (e não foi ignorado). Some da lista ao adicionar ou ignorar.
// Roteamento: ao adicionar, o admin escolhe pra qual FUNIL enviar — quem tem
// acesso àquele funil (gerente/empregado via allowed_users) recebe o lead.
// Fase 1: visível para admin e gestor.
export default function NewArrivals() {
  const navigate = useNavigate();
  const role = auth.profile()?.role;
  const canSee = role === 'admin' || role === 'manager';

  const [arrivals, setArrivals] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [busy, setBusy] = useState(null);      // key em processamento
  const [menu, setMenu] = useState(null);      // key com dropdown aberto
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    const [{ data: msgs }, contacts, ignored, pipes] = await Promise.all([
      supabase.from('whatsapp_messages')
        .select('*')
        .eq('from_me', false)
        .order('timestamp', { ascending: false })
        .limit(80),
      db.contacts.list(),
      db.arrivals.ignoredKeys(),
      db.pipelines.list(),
    ]);

    const known = new Set((contacts || []).map(c => phoneKey(c.phone)).filter(Boolean));
    const skip = new Set(ignored || []);
    const seen = new Set();
    const list = [];
    for (const m of (msgs || [])) {
      // Mensagens de grupo/newsletter não são novos contatos.
      if (String(m.remote_jid || '').includes('@g.us')) continue;
      const phone = m.remote_jid?.replace(/@.*/, '');
      const k = phoneKey(phone);
      if (!k || known.has(k) || skip.has(k) || seen.has(k)) continue;
      seen.add(k);
      list.push({ key: k, phone, name: m.contact_name, content: m.content, time: toMs(m.timestamp) });
    }
    setArrivals(list.slice(0, 8));
    setPipelines(pipes || []);
    setLoaded(true);
  }, []);

  useEffect(() => { if (canSee) load(); }, [canSee, load]);

  useEffect(() => {
    if (!canSee) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(id);
  }, [canSee, load]);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!menu) return;
    function onClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setMenu(null); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menu]);

  // Adiciona ao CRM; se pipelineId vier, também cria o lead no 1º estágio do funil.
  async function add(a, pipelineId) {
    if (busy) return;
    setBusy(a.key);
    setMenu(null);
    try {
      const contact = await db.contacts.create({ name: a.name || a.phone, phone: a.phone });
      if (pipelineId && contact?.id) {
        const stages = await db.stages.list(pipelineId); // já ordenado por position
        const first = stages[0];
        if (first) await db.leads.create({ contact_id: contact.id, stage_id: first.id, pipeline_id: pipelineId });
      }
      setArrivals(prev => prev.filter(x => x.key !== a.key));
    } finally {
      setBusy(null);
    }
  }

  async function ignore(a) {
    if (busy) return;
    setArrivals(prev => prev.filter(x => x.key !== a.key)); // some na hora
    setMenu(null);
    try { await db.arrivals.ignore(a.key); } catch { /* se a tabela não existir, some só na sessão */ }
  }

  if (!canSee || !loaded || arrivals.length === 0) return null;

  return (
    <div ref={rootRef} className="bg-white rounded-xl border border-amber-200 shadow-sm p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-amber-600" />
          </div>
          <h2 className="font-semibold text-sm text-gray-800">
            Novos contatos chegando
            <span className="ml-2 text-[11px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
              {arrivals.length}
            </span>
          </h2>
        </div>
        <span className="text-[11px] text-gray-400">ainda fora do CRM</span>
      </div>

      <div className="space-y-1.5">
        {arrivals.map(a => (
          <div key={a.key} className="flex items-center gap-2 rounded-lg p-1.5 -mx-1.5 hover:bg-gray-50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-green-600" />
            </div>
            <button onClick={() => navigate(`/chats?phone=${a.phone.replace(/\D/g, '')}`)}
              className="flex-1 min-w-0 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-800 truncate">{a.name || a.phone}</p>
                <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(a.time)}</span>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">{a.content || 'Nova mensagem'}</p>
            </button>

            {/* Ignorar (não é cliente) */}
            <button onClick={() => ignore(a)} disabled={busy === a.key} title="Não é cliente — ignorar"
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
              <X className="w-4 h-4" />
            </button>

            {/* Adicionar (+ escolher funil) */}
            <div className="relative shrink-0">
              <button
                onClick={() => (pipelines.length ? setMenu(menu === a.key ? null : a.key) : add(a, null))}
                disabled={busy === a.key}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {busy === a.key
                  ? <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                  : <UserPlus className="w-3.5 h-3.5" />}
                Adicionar
                {pipelines.length > 0 && <ChevronDown className="w-3 h-3" />}
              </button>

              {menu === a.key && pipelines.length > 0 && (
                <div className="absolute right-0 top-9 z-20 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden py-1">
                  <button onClick={() => add(a, null)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    <Check className="w-3.5 h-3.5 text-gray-400" /> Só no CRM (sem funil)
                  </button>
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Enviar para o funil</div>
                  {pipelines.map(p => (
                    <button key={p.id} onClick={() => add(a, p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
