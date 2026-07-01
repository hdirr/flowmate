import { Trash2 } from 'lucide-react';
import { ACTION_TYPES } from '../utils/constants';

const FIELD_LABELS = {
  email:      [{ key: 'to', label: 'Para (e-mail)' }, { key: 'subject', label: 'Assunto' }, { key: 'body', label: 'Mensagem' }],
  whatsapp:   [{ key: 'to', label: 'Número (ex: 5511999...)' }, { key: 'body', label: 'Mensagem' }],
  move_stage: [{ key: 'stage', label: 'Nome da etapa' }],
  add_tag:    [{ key: 'tag', label: 'Nome da tag' }],
  delay:      [{ key: 'minutes', label: 'Minutos de espera' }],
  webhook:    [{ key: 'url', label: 'URL do webhook' }],
};

export default function ActionCard({ action, index, onChange, onRemove }) {
  const fields = FIELD_LABELS[action.type] || [];

  function handleTypeChange(e) {
    onChange({ type: e.target.value });
  }

  function handleFieldChange(key, val) {
    onChange({ ...action, [key]: val });
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ação {index + 1}</span>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <select
        value={action.type}
        onChange={handleTypeChange}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">Selecione uma ação...</option>
        {ACTION_TYPES.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>

      {fields.map(({ key, label }) => (
        key === 'body' ? (
          <textarea
            key={key}
            placeholder={label}
            value={action[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        ) : (
          <input
            key={key}
            type={key === 'minutes' ? 'number' : 'text'}
            placeholder={label}
            value={action[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )
      ))}
    </div>
  );
}
