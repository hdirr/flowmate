import { useState, useRef, useEffect } from 'react';
import { db } from '../lib/store';
import { auth } from '../lib/auth';
import { Plus, User, Trash2, Check, Search, X } from 'lucide-react';
import LeadPanel from '../components/LeadPanel';

const COLORS = ['#6366f1','#3b82f6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6'];

export default function Pipeline() {
  const session = auth.session();
  const canCreateLead  = auth.can('pipeline', 'create');
  const canEditLead    = auth.can('pipeline', 'edit');
  const canRemoveLead  = auth.can('pipeline', 'remove');
  const canViewAll     = auth.can('pipeline', 'view_all');
  const isAdmin        = auth.isAdmin();

  const [stages, setStages] = useState(() => db.stages.list());
  const [leads, setLeads] = useState(() => db.leads.list());
  const [dragging, setDragging] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [editingStage, setEditingStage] = useState(null); // id da etapa sendo editada
  const [editingName, setEditingName] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', stage_id: '' });
  const inputRef = useRef(null);

  function refresh() {
    setLeads(db.leads.list());
    setStages(db.stages.list());
  }

  // Re-renderiza quando uma automação muda dados
  useEffect(() => {
    window.addEventListener('flowmate:update', refresh);
    return () => window.removeEventListener('flowmate:update', refresh);
  }, []);

  function saveStages(updated) {
    db.stages.save(updated);
    setStages([...updated]);
  }

  // Inline edit
  function startEdit(stage, e) {
    e.stopPropagation();
    setEditingStage(stage.id);
    setEditingName(stage.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit(stageId) {
    if (!editingName.trim()) { setEditingStage(null); return; }
    const updated = stages.map(s => s.id === stageId ? { ...s, name: editingName.trim() } : s);
    saveStages(updated);
    setEditingStage(null);
  }

  function changeColor(stageId) {
    const updated = stages.map(s => {
      if (s.id !== stageId) return s;
      const next = COLORS[(COLORS.indexOf(s.color) + 1) % COLORS.length];
      return { ...s, color: next };
    });
    saveStages(updated);
  }

  function addStage() {
    const newStage = {
      id: 's' + Date.now(),
      name: 'Nova etapa',
      color: COLORS[stages.length % COLORS.length],
      position: stages.length + 1,
    };
    const updated = [...stages, newStage];
    saveStages(updated);
    // Entra em modo de edição automaticamente
    setEditingStage(newStage.id);
    setEditingName(newStage.name);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  function removeStage(stageId) {
    if (stages.length <= 1) return;
    if (!confirm('Remover etapa? Os leads nela serão perdidos.')) return;
    const updated = stages.filter(s => s.id !== stageId).map((s, i) => ({ ...s, position: i + 1 }));
    saveStages(updated);
  }

  // Leads
  function createLead() {
    if (!newLead.name.trim()) return;
    const stageId = newLead.stage_id || stages[0]?.id;
    const contact = db.contacts.create({ name: newLead.name.trim(), phone: newLead.phone.trim() });
    db.leads.create({ contact_id: contact.id, stage_id: stageId });
    refresh();
    setNewLead({ name: '', phone: '', stage_id: '' });
    setShowModal(false);
  }

  function onDragStart(lead) { setDragging(lead); }
  function onDrop(stageId) {
    if (dragging && dragging.stage_id !== stageId) {
      db.leads.update(dragging.id, { stage_id: stageId });
      refresh();
    }
    setDragging(null);
  }

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl md:text-2xl font-bold">Pipeline</h1>
        {canCreateLead && (
          <button
            onClick={() => { setNewLead({ name: '', phone: '', stage_id: stages[0]?.id || '' }); setShowModal(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Novo lead
          </button>
        )}
      </div>

      {/* Barra de busca */}
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          placeholder="Buscar lead..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex gap-3 md:gap-4 overflow-x-auto flex-1 pb-4 items-start snap-x snap-mandatory md:snap-none scroll-smooth px-0.5">
        {stages.map(stage => {
          const stageLeads = leads.filter(l =>
            l.stage_id === stage.id &&
            (canViewAll || l.created_by === session?.userId) &&
            (!search || l.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
              l.contact?.phone?.includes(search))
          );
          const isEditing = editingStage === stage.id;

          return (
            <div
              key={stage.id}
              className="w-72 md:w-64 shrink-0 flex flex-col snap-start"
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(stage.id)}
            >
              {/* Header da etapa */}
              <div className="flex items-center gap-2 mb-3 group">
                {/* Bolinha de cor — clica para trocar */}
                <button
                  onClick={() => changeColor(stage.id)}
                  className="w-3 h-3 rounded-full shrink-0 ring-2 ring-transparent hover:ring-gray-300 transition-all"
                  style={{ background: stage.color }}
                  title="Clique para trocar cor"
                />

                {isEditing && isAdmin ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      ref={inputRef}
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(stage.id);
                        if (e.key === 'Escape') setEditingStage(null);
                      }}
                      onBlur={() => commitEdit(stage.id)}
                      className="flex-1 text-sm font-semibold bg-white border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      autoFocus
                    />
                    <button onClick={() => commitEdit(stage.id)} className="text-blue-500 hover:text-blue-700">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span
                    onClick={e => isAdmin && startEdit(stage, e)}
                    className={`flex-1 text-left text-sm font-semibold text-gray-700 truncate ${isAdmin ? 'cursor-pointer hover:text-blue-600' : 'cursor-default'}`}
                    title={isAdmin ? 'Clique para renomear' : ''}
                  >
                    {stage.name}
                  </span>
                )}

                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">{stageLeads.length}</span>

                {isAdmin && stages.length > 1 && (
                  <button
                    onClick={() => removeStage(stage.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                    title="Remover etapa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 flex-1">
                {stageLeads.map(lead => (
                  <div
                    key={lead.id}
                    draggable={canEditLead && (canViewAll || lead.created_by === session?.userId)}
                    onDragStart={() => onDragStart(lead)}
                    onClick={() => setSelected(lead)}
                    className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm cursor-pointer hover:shadow-md hover:border-blue-200 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{lead.contact?.name}</p>
                        <p className="text-xs text-gray-400">{lead.contact?.phone || 'Sem telefone'}</p>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="border-2 border-dashed border-gray-200 rounded-xl h-14 flex items-center justify-center text-gray-300 text-xs">
                  Soltar aqui
                </div>
              </div>
            </div>
          );
        })}

        {/* Botão adicionar etapa — só admin */}
        {isAdmin && (
          <button
            onClick={addStage}
            className="w-52 shrink-0 h-10 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center gap-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors self-start"
          >
            <Plus className="w-4 h-4" /> Adicionar etapa
          </button>
        )}
      </div>

      {selected && (
        <LeadPanel
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => { refresh(); setSelected(db.leads.list().find(l => l.id === selected.id) || null); }}
          onRemove={() => { refresh(); setSelected(null); }}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-bold text-lg mb-4">Novo lead</h2>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Nome *</label>
            <input
              placeholder="Nome do contato"
              value={newLead.name}
              onChange={e => setNewLead(n => ({ ...n, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoFocus
            />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Telefone</label>
            <input
              placeholder="(00) 00000-0000"
              value={newLead.phone}
              onChange={e => setNewLead(n => ({ ...n, phone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Etapa</label>
            <div className="flex flex-col gap-1.5 mb-4">
              {stages.map(s => (
                <button key={s.id} type="button"
                  onClick={() => setNewLead(n => ({ ...n, stage_id: s.id }))}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                    ${(newLead.stage_id || stages[0]?.id) === s.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                  {s.name}
                  {(newLead.stage_id || stages[0]?.id) === s.id && <span className="ml-auto text-blue-500">✓</span>}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={createLead} disabled={!newLead.name.trim()} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
