import { useState, useRef, useEffect } from 'react';
import { X, Plus, Lock, Loader2, Check, Tag } from 'lucide-react';

// Chip de etiqueta (cor da paleta). onRemove → mostra o "x".
export function LabelChip({ label, onRemove, small = false, busy = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium border max-w-[10rem] ${small ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'}`}
      style={{ color: label.color, background: label.color + '14', borderColor: label.color + '40' }}
      title={label.kind === 'system' ? `${label.name} (etiqueta de sistema)` : label.name}>
      <span className={`rounded-full shrink-0 ${small ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} style={{ background: label.color }} />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button type="button" onClick={e => { e.stopPropagation(); onRemove(label); }} disabled={busy}
          title={`Remover "${label.name}"`} className="hover:opacity-70 disabled:opacity-40 -mr-0.5">
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// Linha de chips + botão "Etiqueta" que abre a lista para marcar/desmarcar.
// all: etiquetas disponíveis; current: as aplicadas; onToggle(label, add) → Promise.
// allowSystem: mostra as de sistema no seletor (conversa individual). As de sistema nunca
// têm "x" (não dá para ficar sem nenhuma: troca-se pela outra).
export default function LabelChips({ all, current, onToggle, allowSystem = false, disabled = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const currentIds = new Set((current || []).map(l => l.id));
  const options = (all || []).filter(l => allowSystem || l.kind !== 'system');

  async function toggle(label, add) {
    setBusyId(label.id);
    setError('');
    try { await onToggle(label, add); }
    catch (e) { setError(e.message); }
    setBusyId(null);
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1" ref={boxRef}>
      {(current || []).map(l => (
        <LabelChip key={l.id} label={l} small={compact} busy={busyId === l.id}
          onRemove={!disabled && l.kind !== 'system' ? () => toggle(l, false) : undefined} />
      ))}
      {!disabled && (
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-300 ${compact ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'}`}>
          <Plus className="w-3 h-3" /> Etiqueta
        </button>
      )}
      {error && <span className="text-[11px] text-red-500 w-full">{error}</span>}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 w-60 max-h-72 overflow-y-auto">
          {options.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Nenhuma etiqueta. Crie em Configurações → Etiquetas.
            </p>
          ) : options.map(l => {
            const on = currentIds.has(l.id);
            const locked = l.kind === 'system' && on; // sistema aplicada: não sai, só troca
            return (
              <button key={l.id} type="button" disabled={busyId === l.id || locked}
                onClick={() => toggle(l, !on)}
                title={locked ? 'Etiqueta de sistema: para trocar, aplique a outra' : undefined}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left disabled:cursor-default">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="flex-1 truncate">{l.name}</span>
                {l.kind === 'system' && <Lock className="w-3 h-3 text-gray-300" />}
                {busyId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                  : on ? <Check className="w-3.5 h-3.5 text-blue-500" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ids → objetos (na ordem da lista: sistema primeiro, depois por nome).
export function pickLabels(all, ids) {
  const set = new Set(ids || []);
  return (all || []).filter(l => set.has(l.id));
}
