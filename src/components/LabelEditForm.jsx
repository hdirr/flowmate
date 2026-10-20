import { useState } from 'react';
import { Loader2, Check, Info } from 'lucide-react';
import { labelsApi } from '../lib/labels';
import { LABEL_COLORS } from '../../api/_lib/labelColors.js';
import { labelSlug } from '../../api/_lib/labelName.js';

// Edição de etiqueta (nome com slug + prévia, e cor) — o MESMO formulário em Configurações →
// Etiquetas e no lápis dos seletores/chips (painéis de contato e lead, cabeçalho do Chats).
// Sistema ("Atendimento humano"/"Atendimento IA"): nome travado, só a cor muda. Quem pode
// editar é decidido por quem usa (can_manage); o servidor confere de novo.

export function NamePreview({ value }) {
  const v = value.trim();
  if (!v) return null;
  const s = labelSlug(v);
  if (!s) return <p className="text-xs text-red-500">Nome inválido: use letras ou números.</p>;
  return <p className="text-xs text-gray-400">Nome final: <span className="font-mono text-gray-600">{s}</span></p>;
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LABEL_COLORS.map(c => (
        <button key={c.color} type="button" onClick={() => onChange(c.color)} title={c.name}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${value === c.color ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'hover:scale-110'}`}
          style={{ background: c.color }}>
          {value === c.color && <Check className="w-3.5 h-3.5 text-white" />}
        </button>
      ))}
    </div>
  );
}

// label: { id, name, color, kind }. onSaved(etiquetaAtualizada | null se nada mudou).
export default function LabelEditForm({ label, onSaved, onCancel }) {
  const system = label.kind === 'system';
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const patch = {};
    if (!system && labelSlug(name) !== label.name) patch.name = name.trim();
    if (color !== label.color) patch.color = color;
    if (!Object.keys(patch).length) { onSaved(null); return; }
    setBusy(true);
    setError('');
    try { onSaved(await labelsApi.update(label.id, patch)); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="space-y-3" onClick={e => e.stopPropagation()}>
      <input value={name} maxLength={200} disabled={system} autoFocus={!system}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400" />
      {!system && <NamePreview value={name} />}
      {system && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Etiqueta de sistema: o nome não muda e ela não pode ser excluída, porque as automações e a pausa da conversa dependem dela. Só a cor pode mudar.
        </p>
      )}
      <ColorPicker value={color} onChange={setColor} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
        <button type="button" onClick={save} disabled={busy || (!system && !labelSlug(name))}
          className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}
