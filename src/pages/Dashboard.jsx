import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/store';
import { Users, KanbanSquare, Bot, ArrowRight, TrendingUp, TrendingDown, Sparkles, Target } from 'lucide-react';

const DAY = 86400000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.leads.list(),
      db.contacts.list(),
      db.workflows.list(),
      db.stages.list(),
    ]).then(([l, c, w, s]) => {
      setLeads(l);
      setContacts(c);
      setWorkflows(w);
      setStages(s);
      setLoading(false);
    });
  }, []);

  const activeWorkflows = workflows.filter(w => w.enabled).length;

  const leadsByStage = useMemo(() => stages.map(s => ({
    ...s,
    count: leads.filter(l => l.stage_id === s.id).length,
  })), [stages, leads]);

  // Novos leads: últimos 7 dias vs 7 dias anteriores (para tendência)
  const now = Date.now();
  const { newLeads7d, trendPct } = useMemo(() => {
    const cut7 = now - 7 * DAY;
    const cut14 = now - 14 * DAY;
    const last7 = leads.filter(l => l.created_at && new Date(l.created_at).getTime() >= cut7).length;
    const prev7 = leads.filter(l => {
      if (!l.created_at) return false;
      const t = new Date(l.created_at).getTime();
      return t >= cut14 && t < cut7;
    }).length;
    let pct = 0;
    if (prev7 === 0) pct = last7 > 0 ? 100 : 0;
    else pct = Math.round(((last7 - prev7) / prev7) * 100);
    return { newLeads7d: last7, trendPct: pct };
  }, [leads, now]);

  // Taxa de conversão: leads na última etapa / total
  const conversionRate = useMemo(() => {
    if (!leads.length || !stages.length) return 0;
    const lastStage = stages[stages.length - 1];
    const converted = leads.filter(l => l.stage_id === lastStage.id).length;
    return Math.round((converted / leads.length) * 100);
  }, [leads, stages]);

  // Leads por dia — últimos 7 dias
  const leadsByDay = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const start = startOfDay(now - i * DAY);
      const end = start + DAY;
      const count = leads.filter(l => {
        if (!l.created_at) return false;
        const t = new Date(l.created_at).getTime();
        return t >= start && t < end;
      }).length;
      days.push({
        label: new Date(start).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
        dayNum: new Date(start).getDate(),
        count,
      });
    }
    return days;
  }, [leads, now]);

  const maxDayCount = Math.max(1, ...leadsByDay.map(d => d.count));
  const recentContacts = contacts.slice(0, 5);

  const cards = [
    { label: 'Leads ativos', value: leads.length,      icon: KanbanSquare, color: 'bg-blue-500',    path: '/pipeline' },
    { label: 'Contatos',     value: contacts.length,   icon: Users,        color: 'bg-violet-500',  path: '/contatos' },
    { label: 'Novos (7 dias)', value: newLeads7d,      icon: Sparkles,     color: 'bg-emerald-500', path: '/pipeline', trend: trendPct },
    { label: 'Conversão',    value: `${conversionRate}%`, icon: Target,    color: 'bg-amber-500',   path: '/pipeline', hint: stages.length ? `→ ${stages[stages.length - 1].name}` : null },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Início</h1>
        <span className="text-xs text-gray-400">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {cards.map(({ label, value, icon: Icon, color, path, trend, hint }) => (
          <button key={label} onClick={() => navigate(path)}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${color} rounded-lg flex items-center justify-center`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              {trend !== undefined && trend !== 0 && (
                <span className={`flex items-center gap-0.5 text-xs font-semibold ${trend > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                  {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(trend)}%
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">{loading ? '—' : value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            {hint && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{hint}</p>}
          </button>
        ))}
      </div>

      {/* Gráfico: novos leads últimos 7 dias */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-sm">Novos leads · últimos 7 dias</h2>
          <span className="text-xs text-gray-400">{newLeads7d} no total</span>
        </div>
        <div className="flex items-end justify-between gap-2 h-32">
          {leadsByDay.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <span className="text-xs font-semibold text-gray-600">{d.count > 0 ? d.count : ''}</span>
              <div className="w-full bg-blue-50 rounded-lg relative overflow-hidden" style={{ height: '100%' }}>
                <div
                  className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-500 to-blue-400 rounded-lg transition-all duration-500"
                  style={{ height: `${(d.count / maxDayCount) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 capitalize">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pipeline funil */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm">Pipeline</h2>
            <button onClick={() => navigate('/pipeline')} className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
              Ver tudo <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2.5">
            {leadsByStage.map(s => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-sm text-gray-600 flex-1 truncate">{s.name}</span>
                <span className="text-sm font-semibold w-6 text-right">{s.count}</span>
                <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    background: s.color,
                    width: leads.length ? `${(s.count / leads.length) * 100}%` : '0%'
                  }} />
                </div>
              </div>
            ))}
            {leadsByStage.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhuma etapa ainda</p>}
          </div>
        </div>

        {/* Contatos recentes */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm">Contatos recentes</h2>
            <button onClick={() => navigate('/contatos')} className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
              Ver tudo <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {recentContacts.map(c => (
              <button key={c.id} onClick={() => navigate('/contatos')}
                className="w-full flex items-center gap-3 hover:bg-gray-50 rounded-lg p-1.5 -mx-1.5 transition-colors text-left">
                <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-violet-600">{c.name?.[0]?.toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 truncate">{c.phone || c.email || 'Sem contato'}</p>
                </div>
              </button>
            ))}
            {contacts.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhum contato ainda</p>}
          </div>
        </div>
      </div>

      {/* Robôs — rodapé compacto */}
      <button onClick={() => navigate('/automacoes')}
        className="w-full mt-6 bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow text-left">
        <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Automações</p>
          <p className="text-xs text-gray-400">{activeWorkflows} robô{activeWorkflows !== 1 ? 's' : ''} ativo{activeWorkflows !== 1 ? 's' : ''} de {workflows.length}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-300" />
      </button>
    </div>
  );
}
