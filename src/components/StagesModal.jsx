import { useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { db } from '../lib/store';

const COLORS = [
  '#6366f1','#3b82f6','#06b6d4','#10b981',
  '#f59e0b','#ef4444','#ec4899','#8b5cf6',
];

export default function StagesModal({ onClose, onSave }) {
  const [stages, setStages] = useState(() => db.stages.list());

  function update(idx, field, value) {
    setStages(s => s.map((st, i) => i === idx ? { ...st, [field]: value } : st));
  }

  function add() {
    setStages(s => [...s, {
      id: 's' + Date.now(),
      name: 'Nova etapa',
      color: COLORS[s.length % COLORS.length],
      position: s.length + 1,
    }]);
  }

  function remove(idx) {
    setStages(s => s.filter((_, i) => i !== idx).map((st, i) => ({ ...st, position: i + 1 })));
  }

  function moveUp(idx) {
    if (idx === 0) return;
    setStages(s => {
      const next = [...s];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((st, i) => ({ ...st, position: i + 1 }));
    });
  }

  function moveDown(idx) {
    setStages(s => {
      if (idx === s.length - 1) return s;
      const next = [...s];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((st, i) => ({ ...st, position: i + 1 }));
    });
  }

  function save() {
    const updated = stages.map((s, i) => ({ ...s, position: i + 1 }));
    db.stages.save(updated);
    onSave(updated);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">

        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-lg">Gerenciar etapas</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-700" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {stages.map((stage, idx) => (
            <div key={stage.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">

              {/* Reorder buttons */}
              <div className="flex flex-col shrink-0">
                <button onClick={() => moveUp(idx)} disabled={idx === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx === stages.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Color cycle */}
              <button
                type="button"
                onClick={() => update(idx, 'color', COLORS[(COLORS.indexOf(stage.color) + 1) % COLORS.length])}
                className="w-5 h-5 rounded-full shrink-0 border-2 border-white shadow ring-1 ring-gray-200"
                style={{ background: stage.color }}
                title="Clique para trocar a cor"
              />

              {/* Name input — stopPropagation prevents drag conflicts */}
              <input
                type="text"
                value={stage.name}
                onChange={e => update(idx, 'name', e.target.value)}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />

              {/* Remove */}
              {stages.length > 1 && (
                <button onClick={() => remove(idx)}
                  className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
          <button onClick={add}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Adicionar etapa
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={save} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
