import { useState } from 'react';
import { db } from '../lib/store';
import { Bot, Plus } from 'lucide-react';
import { TRIGGER_TYPES } from '../utils/constants';

export default function WorkflowList({ onNew, onEdit }) {
  const [workflows, setWorkflows] = useState(() => db.workflows.list());

  function toggle(id, current) {
    db.workflows.update(id, { enabled: !current });
    setWorkflows(db.workflows.list());
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          <Bot className="w-6 h-6" /> Automações
        </h1>
        <button onClick={onNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex gap-2 items-center text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Novo robô
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma automação ainda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map(wf => (
            <div key={wf.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
              <button className="flex-1 text-left" onClick={() => onEdit?.(wf.id)}>
                <p className="font-semibold text-sm">{wf.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Gatilho: {TRIGGER_TYPES.find(t => t.value === wf.trigger_type)?.label ?? wf.trigger_type} · {wf.actions?.length || 0} ação(ões)
                </p>
              </button>
              <button
                onClick={() => toggle(wf.id, wf.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${wf.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${wf.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
