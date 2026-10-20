import { useState } from 'react';
import { Plus, Pencil, Trash2, Lock, Loader2, Info } from 'lucide-react';
import { labelsApi } from '../lib/labels';
import { DEFAULT_LABEL_COLOR } from '../../api/_lib/labelColors.js';
import { LabelChip } from './LabelChips';
import { labelSlug } from '../../api/_lib/labelName.js';
import LabelEditForm, { NamePreview, ColorPicker } from './LabelEditForm';

// Configurações → Etiquetas (PLANO-ETIQUETAS, ET-4). Só aparece com a chave `labels` ligada.
// Criar/editar/excluir: quem acessa Configurações (o servidor confere de novo).
// Sistema ("Atendimento humano"/"Atendimento IA"): só a cor muda.

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export default function LabelsPanel({ data, onReload }) {
  const labels = data?.labels || [];
  const canManage = !!data?.can_manage;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_LABEL_COLOR);
  const [editing, setEditing] = useState(null); // id da etiqueta em edição
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn) {
    setBusy(true);
    setError('');
    try { await fn(); await onReload(); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  }

  async function create() {
    if (!labelSlug(newName)) return;
    const ok = await run(() => labelsApi.create(newName.trim(), newColor));
    if (ok) { setCreating(false); setNewName(''); setNewColor(DEFAULT_LABEL_COLOR); }
  }

  async function remove(l) {
    const msg = `Excluir a etiqueta "${l.name}"?\n\n`
      + `Ela sai de ${plural(l.contacts_count || 0, 'contato', 'contatos')} e de ${plural(l.conversations_count || 0, 'conversa', 'conversas')}. `
      + 'Esta ação não pode ser desfeita.';
    if (!confirm(msg)) return;
    await run(() => labelsApi.remove(l.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Etiquetas</h2>
          <p className="text-sm text-gray-400 mt-0.5">Marque contatos e conversas para organizar seus fluxos. As etiquetas também chegam na sua automação (n8n).</p>
        </div>
        {canManage && !creating && (
          <button onClick={() => { setCreating(true); setError(''); }}
            className="shrink-0 bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Nova etiqueta
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {creating && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
          <input autoFocus value={newName} maxLength={200} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="Nome da etiqueta (ex.: Retorno, VIP, Orçamento enviado)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
          <NamePreview value={newName} />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex items-center gap-2">
            {labelSlug(newName) && <LabelChip label={{ name: labelSlug(newName), color: newColor, kind: 'user' }} />}
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setCreating(false); setNewName(''); }} className="border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={create} disabled={!labelSlug(newName) || busy}
                className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {labels.map(l => {
          const isEditing = editing === l.id;
          const system = l.kind === 'system';
          return (
            <div key={l.id} className="px-4 py-3">
              {isEditing ? (
                <LabelEditForm label={l} onCancel={() => setEditing(null)}
                  onSaved={async () => { setEditing(null); await onReload(); }} />
              ) : (
                <div className="flex items-center gap-3">
                  <LabelChip label={l} />
                  {system && (
                    <span className="text-[11px] text-gray-400 flex items-center gap-1" title="As automações e a pausa da conversa dependem desta etiqueta: o nome não muda e ela não pode ser excluída.">
                      <Lock className="w-3 h-3" /> sistema
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 text-right">
                    {system ? plural(l.conversations_count || 0, 'conversa', 'conversas')
                      : `${plural(l.contacts_count || 0, 'contato', 'contatos')} · ${plural(l.conversations_count || 0, 'conversa', 'conversas')}`}
                  </span>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditing(l.id); setError(''); }}
                        title={system ? 'Mudar a cor' : 'Editar'} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!system && (
                        <button onClick={() => remove(l)} disabled={busy} title="Excluir"
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-40">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {labels.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">Nenhuma etiqueta ainda.</p>}
      </div>

      <p className="text-xs text-gray-400 flex gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Aplique no painel do contato (Contatos ou Chats) e no cabeçalho da conversa. "Atendimento humano" e "Atendimento IA" só valem em conversa individual.
      </p>
    </div>
  );
}
