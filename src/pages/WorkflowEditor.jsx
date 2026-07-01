import { useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { db } from '../lib/store';
import TriggerCard from '../components/TriggerCard';
import ActionCard from '../components/ActionCard';
import AddActionButton from '../components/AddActionButton';

export default function WorkflowEditor({ id, onBack }) {
  const existing = id ? db.workflows.list().find(w => w.id === id) : null;

  const [name, setName] = useState(existing?.name || '');
  const [triggerType, setTriggerType] = useState(existing?.trigger_type || '');
  const [actions, setActions] = useState(existing?.actions || []);
  const [error, setError] = useState('');

  function addAction() { setActions(p => [...p, { type: '' }]); }
  function updateAction(i, data) { setActions(p => p.map((a, idx) => idx === i ? data : a)); }
  function removeAction(i) { setActions(p => p.filter((_, idx) => idx !== i)); }

  function save() {
    setError('');
    if (!name.trim()) { setError('Dê um nome ao robô.'); return; }
    if (!triggerType) { setError('Selecione um gatilho.'); return; }
    const payload = { name: name.trim(), trigger_type: triggerType, actions };
    if (id) db.workflows.update(id, payload);
    else db.workflows.create(payload);
    onBack();
  }

  function remove() {
    if (!confirm('Remover esta automação?')) return;
    db.workflows.remove(id);
    onBack();
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex-1">{id ? 'Editar robô' : 'Novo robô'}</h1>
        {id && (
          <button onClick={remove} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-sm">
            <Trash2 className="w-4 h-4" /> Remover
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Nome do robô</label>
          <input
            placeholder="Ex: Boas-vindas para novo contato"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <TriggerCard value={triggerType} onChange={setTriggerType} />

        {actions.map((action, i) => (
          <ActionCard
            key={i}
            action={action}
            index={i}
            onChange={data => updateAction(i, data)}
            onRemove={() => removeAction(i)}
          />
        ))}

        <AddActionButton onClick={addAction} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={save}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Save className="w-4 h-4" />
          Salvar robô
        </button>
      </div>
    </div>
  );
}
