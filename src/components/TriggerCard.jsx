import { Zap } from 'lucide-react';
import { TRIGGER_TYPES } from '../utils/constants';

export default function TriggerCard({ value, onChange }) {
  return (
    <div className="border-2 border-blue-200 rounded-xl p-4 bg-blue-50">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Gatilho</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">Selecione um gatilho...</option>
        {TRIGGER_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
    </div>
  );
}
