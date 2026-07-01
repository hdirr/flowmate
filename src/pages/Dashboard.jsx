import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/store';
import { Users, KanbanSquare, Bot, TrendingUp, ArrowRight } from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const leads = db.leads.list();
  const contacts = db.contacts.list();
  const workflows = db.workflows.list();
  const stages = db.stages.list();

  const activeWorkflows = workflows.filter(w => w.enabled).length;

  const leadsByStage = stages.map(s => ({
    ...s,
    count: leads.filter(l => l.stage_id === s.id).length,
  }));

  const recentContacts = contacts.slice(0, 5);

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Início</h1>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Leads ativos',   value: leads.length,          icon: KanbanSquare, color: 'bg-blue-500',    path: '/pipeline' },
          { label: 'Contatos',       value: contacts.length,       icon: Users,        color: 'bg-violet-500', path: '/contatos' },
          { label: 'Robôs ativos',   value: activeWorkflows,       icon: Bot,          color: 'bg-emerald-500',path: '/automacoes' },
          { label: 'Total de robôs', value: workflows.length,      icon: TrendingUp,   color: 'bg-amber-500',  path: '/automacoes' },
        ].map(({ label, value, icon: Icon, color, path }) => (
          <button key={label} onClick={() => navigate(path)}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left hover:shadow-md transition-shadow">
            <div className={`w-9 h-9 ${color} rounded-lg flex items-center justify-center mb-3`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pipeline resumo */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold text-sm">Pipeline</h2>
            <button onClick={() => navigate('/pipeline')} className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
              Ver tudo <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {leadsByStage.map(s => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-sm text-gray-600 flex-1">{s.name}</span>
                <span className="text-sm font-semibold">{s.count}</span>
                <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    background: s.color,
                    width: leads.length ? `${(s.count / leads.length) * 100}%` : '0%'
                  }} />
                </div>
              </div>
            ))}
            {leads.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhum lead ainda</p>}
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
              <div key={c.id} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-violet-600">{c.name[0].toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-sm font-medium leading-tight">{c.name}</p>
                  <p className="text-xs text-gray-400">{c.phone || c.email || 'Sem contato'}</p>
                </div>
              </div>
            ))}
            {contacts.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhum contato ainda</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
