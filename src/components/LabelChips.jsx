import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Lock, Loader2, Check, Tag, Search, Pencil } from 'lucide-react';
import { labelSlug } from '../../api/_lib/labelName.js';
import LabelEditForm from './LabelEditForm';

// Chip de etiqueta (cor da paleta). onRemove → mostra o "x"; onEdit → mostra o lápis.
export function LabelChip({ label, onRemove, onEdit, small = false, busy = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium border max-w-[10rem] ${small ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'}`}
      style={{ color: label.color, background: label.color + '14', borderColor: label.color + '40' }}
      title={label.kind === 'system' ? `${label.name} (etiqueta de sistema)` : label.name}>
      <span className={`rounded-full shrink-0 ${small ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} style={{ background: label.color }} />
      <span className="truncate">{label.name}</span>
      {onEdit && (
        <button type="button" onClick={e => { e.stopPropagation(); onEdit(label); }}
          title={label.kind === 'system' ? `Mudar a cor de "${label.name}"` : `Editar "${label.name}"`} className="hover:opacity-70 opacity-60">
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}
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
// onCreate(nome) → Promise: "Criar <nome>" no seletor (só para quem gerencia etiquetas; sem
// onCreate, só aplica as existentes). O nome vira slug; a prévia aparece enquanto digita.
// onEdited(etiqueta) → Promise: lápis nos chips e no seletor, com o MESMO formulário de
// Configurações (LabelEditForm). Só para quem gerencia etiquetas; sistema só troca a cor.
export default function LabelChips({ all, current, onToggle, onCreate, onEdited, allowSystem = false, disabled = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
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
  const q = query.trim();
  const slug = labelSlug(q);
  const options = (all || []).filter(l => (allowSystem || l.kind !== 'system')
    && (!q || l.name.toLowerCase().includes(q.toLowerCase()) || (slug && l.name.includes(slug))));
  const slugExists = !!slug && (all || []).some(l => l.kind === 'user' && l.name === slug);

  async function create() {
    if (!slug || creating) return;
    setCreating(true);
    setError('');
    try { await onCreate(q); setQuery(''); setOpen(false); }
    catch (e) { setError(e.message); }
    setCreating(false);
  }

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
          onEdit={!disabled && onEdited ? lab => { setOpen(false); setEditing(lab); } : undefined}
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
        <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 w-64 max-h-80 overflow-y-auto">
          <div className="px-2 pb-1.5 border-b border-gray-50">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
              <input autoFocus value={query} maxLength={200} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && onCreate && slug && !slugExists) create(); if (e.key === 'Escape') setOpen(false); }}
                placeholder={onCreate ? 'Buscar ou criar etiqueta…' : 'Buscar etiqueta…'}
                className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            {q && slug && slug !== q && (
              <p className="text-[11px] text-gray-400 mt-1 px-0.5">Nome final: <span className="font-mono text-gray-600">{slug}</span></p>
            )}
            {q && !slug && (
              <p className="text-[11px] text-red-500 mt-1 px-0.5">Nome inválido: use letras ou números.</p>
            )}
          </div>
          {onCreate && slug && !slugExists && (
            <button type="button" onClick={create} disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 text-left disabled:opacity-50">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span className="truncate">Criar “{slug}”</span>
            </button>
          )}
          {options.length === 0 && !(onCreate && slug && !slugExists) ? (
            <p className="text-xs text-gray-400 px-3 py-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" /> {q ? 'Nenhuma etiqueta encontrada.' : 'Nenhuma etiqueta. Crie em Configurações → Etiquetas.'}
            </p>
          ) : options.map(l => {
            const on = currentIds.has(l.id);
            const locked = l.kind === 'system' && on; // sistema aplicada: não sai, só troca
            return (
              <div key={l.id} className="flex items-center hover:bg-gray-50">
                <button type="button" disabled={busyId === l.id || locked}
                  onClick={() => toggle(l, !on)}
                  title={locked ? 'Etiqueta de sistema: para trocar, aplique a outra' : undefined}
                  className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-1.5 text-sm text-gray-700 text-left disabled:cursor-default">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="flex-1 truncate">{l.name}</span>
                  {l.kind === 'system' && <Lock className="w-3 h-3 text-gray-300" />}
                  {busyId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                    : on ? <Check className="w-3.5 h-3.5 text-blue-500" /> : null}
                </button>
                {onEdited && (
                  <button type="button" onClick={() => { setOpen(false); setEditing(l); }}
                    title={l.kind === 'system' ? 'Mudar a cor' : 'Editar nome e cor'}
                    className="px-2 py-1.5 text-gray-300 hover:text-blue-600">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-3">{editing.kind === 'system' ? 'Cor da etiqueta' : 'Editar etiqueta'}</h3>
            <LabelEditForm label={editing} onCancel={() => setEditing(null)}
              onSaved={async updated => { setEditing(null); if (updated) { try { await onEdited(updated); } catch { /* já salvo */ } } }} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ids → objetos (na ordem da lista: sistema primeiro, depois por nome).
export function pickLabels(all, ids) {
  const set = new Set(ids || []);
  return (all || []).filter(l => set.has(l.id));
}
