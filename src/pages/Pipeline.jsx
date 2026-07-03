import { useState, useRef, useEffect, useCallback } from 'react';
import { db } from '../lib/store';
import { auth, userStore } from '../lib/auth';
import { Plus, User, Trash2, Check, Search, X, ChevronDown, Settings2, Users, Loader2 } from 'lucide-react';
import LeadPanel from '../components/LeadPanel';

const COLORS = ['#6366f1','#3b82f6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6'];
const LAST_KEY = 'flowmate:lastPipeline';

export default function Pipeline() {
  const session = auth.session();
  const role = auth.profile()?.role;
  const isAdmin = auth.isAdmin();
  const canEditStructure = isAdmin || role === 'manager'; // criar/editar/reordenar etapas
  const canManageFunnels = isAdmin;                        // criar/excluir funil + acesso
  const canCreateLead  = auth.can('pipeline', 'create');
  const canEditLead    = auth.can('pipeline', 'edit');
  const canViewAll     = auth.can('pipeline', 'view_all');
  const myUserId = session?.user?.id;

  const [pipelines, setPipelines] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dragging, setDragging] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [editingStage, setEditingStage] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', stage_id: '' });
  const inputRef = useRef(null);

  // Modal de funil (criar/editar)
  const [funnelModal, setFunnelModal] = useState(null); // null | 'new' | pipelineObj
  const [funnelForm, setFunnelForm] = useState({ name: '', allowedUsers: [] });
  const [companyUsers, setCompanyUsers] = useState([]);
  const [savingFunnel, setSavingFunnel] = useState(false);

  // Funis acessíveis ao usuário
  const accessible = pipelines.filter(p =>
    isAdmin || (p.allowed_users || []).includes(myUserId) || p.created_by === myUserId
  );
  const current = accessible.find(p => p.id === currentId) || accessible[0] || null;

  const loadPipelines = useCallback(async () => {
    const ps = await db.pipelines.list();
    setPipelines(ps);
    return ps;
  }, []);

  const loadBoard = useCallback(async (pid) => {
    if (!pid) { setStages([]); setLeads([]); return; }
    const [s, l] = await Promise.all([db.stages.list(pid), db.leads.list(pid)]);
    setStages(s);
    setLeads(l);
  }, []);

  // Carga inicial
  useEffect(() => {
    (async () => {
      const ps = await loadPipelines();
      const acc = ps.filter(p => isAdmin || (p.allowed_users || []).includes(myUserId) || p.created_by === myUserId);
      const last = localStorage.getItem(LAST_KEY);
      const pick = acc.find(p => p.id === last) || acc[0];
      setCurrentId(pick?.id || null);
      await loadBoard(pick?.id);
      setLoading(false);
    })();
  }, [loadPipelines, loadBoard, isAdmin, myUserId]);

  useEffect(() => {
    if (currentId) localStorage.setItem(LAST_KEY, currentId);
  }, [currentId]);

  const refresh = useCallback(async () => { await loadBoard(current?.id); }, [loadBoard, current?.id]);

  useEffect(() => {
    window.addEventListener('flowmate:update', refresh);
    return () => window.removeEventListener('flowmate:update', refresh);
  }, [refresh]);

  async function switchFunnel(pid) {
    setCurrentId(pid);
    setSearch('');
    await loadBoard(pid);
  }

  // ─── Etapas (estrutura) ───
  async function saveStages(updated) {
    await db.stages.save(updated);
    setStages([...updated]);
  }
  function startEdit(stage, e) {
    e.stopPropagation();
    if (!canEditStructure) return;
    setEditingStage(stage.id);
    setEditingName(stage.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  async function commitEdit(stageId) {
    if (!editingName.trim()) { setEditingStage(null); return; }
    const updated = stages.map(s => s.id === stageId ? { ...s, name: editingName.trim() } : s);
    await saveStages(updated);
    setEditingStage(null);
  }
  async function changeColor(stageId) {
    if (!canEditStructure) return;
    const updated = stages.map(s => {
      if (s.id !== stageId) return s;
      const next = COLORS[(COLORS.indexOf(s.color) + 1) % COLORS.length];
      return { ...s, color: next };
    });
    await saveStages(updated);
  }
  async function addStage() {
    const row = await db.stages.create({
      name: 'Nova etapa',
      color: COLORS[stages.length % COLORS.length],
      position: stages.length + 1,
      pipeline_id: current.id,
    });
    if (row) {
      setStages(prev => [...prev, row]);
      setEditingStage(row.id);
      setEditingName(row.name);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }
  async function removeStage(stageId) {
    if (stages.length <= 1) return;
    if (!confirm('Remover etapa? Os leads nela serão perdidos.')) return;
    await db.stages.remove(stageId);
    await refresh();
  }

  // ─── Leads ───
  async function createLead() {
    if (!newLead.name.trim()) return;
    const stageId = newLead.stage_id || stages[0]?.id;
    const contact = await db.contacts.create({ name: newLead.name.trim(), phone: newLead.phone.trim() });
    if (contact) await db.leads.create({ contact_id: contact.id, stage_id: stageId, pipeline_id: current.id });
    await refresh();
    setNewLead({ name: '', phone: '', stage_id: '' });
    setShowLeadModal(false);
  }
  function onDragStart(lead) { setDragging(lead); }
  async function onDrop(stageId) {
    if (dragging && dragging.stage_id !== stageId) {
      await db.leads.update(dragging.id, { stage_id: stageId });
      await refresh();
    }
    setDragging(null);
  }

  // ─── Funis ───
  async function openFunnelModal(pipe) {
    if (pipe && pipe !== 'new') {
      setFunnelForm({ name: pipe.name, allowedUsers: pipe.allowed_users || [] });
    } else {
      setFunnelForm({ name: '', allowedUsers: [] });
    }
    setFunnelModal(pipe || 'new');
    // Carrega usuários da empresa (exceto admins, que já têm acesso total)
    const us = await userStore.list();
    setCompanyUsers(us.filter(u => u.role !== 'admin'));
  }
  async function saveFunnel() {
    if (!funnelForm.name.trim()) return;
    setSavingFunnel(true);
    if (funnelModal === 'new') {
      const pipe = await db.pipelines.create({ name: funnelForm.name.trim(), allowedUsers: funnelForm.allowedUsers });
      await loadPipelines();
      if (pipe) { setCurrentId(pipe.id); await loadBoard(pipe.id); }
    } else {
      await db.pipelines.update(funnelModal.id, { name: funnelForm.name.trim(), allowedUsers: funnelForm.allowedUsers });
      await loadPipelines();
    }
    setSavingFunnel(false);
    setFunnelModal(null);
  }
  async function removeFunnel(pipe) {
    if (!confirm(`Excluir o funil "${pipe.name}"? Todos os leads e etapas dele serão removidos.`)) return;
    await db.pipelines.remove(pipe.id);
    const ps = await loadPipelines();
    const acc = ps.filter(p => isAdmin || (p.allowed_users || []).includes(myUserId) || p.created_by === myUserId);
    const next = acc[0];
    setCurrentId(next?.id || null);
    await loadBoard(next?.id);
    setFunnelModal(null);
  }
  function toggleUser(uid) {
    setFunnelForm(f => ({
      ...f,
      allowedUsers: f.allowedUsers.includes(uid) ? f.allowedUsers.filter(x => x !== uid) : [...f.allowedUsers, uid],
    }));
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  if (accessible.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-gray-500 mt-16">
        <Users className="w-10 h-10 text-gray-300" />
        <p className="font-medium">Nenhum funil disponível para você.</p>
        {canManageFunnels && (
          <button onClick={() => openFunnelModal('new')} className="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            Criar primeiro funil
          </button>
        )}
        {funnelModal && <FunnelModal />}
      </div>
    );
  }

  function FunnelModal() {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && setFunnelModal(null)}>
        <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg">{funnelModal === 'new' ? 'Novo funil' : 'Configurar funil'}</h2>
            <button onClick={() => setFunnelModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Nome do funil</label>
          <input value={funnelForm.name} onChange={e => setFunnelForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Ex: Vendas, Suporte, Pós-venda"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />

          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Quem tem acesso
          </label>
          <p className="text-xs text-gray-400 mb-2">Admins têm acesso a todos os funis. Marque os gerentes/vendedores que poderão usar este.</p>
          <div className="space-y-1.5 mb-5 max-h-52 overflow-y-auto">
            {companyUsers.length === 0 && <p className="text-xs text-gray-400 py-2">Nenhum outro usuário na empresa.</p>}
            {companyUsers.map(u => {
              const on = funnelForm.allowedUsers.includes(u.id);
              return (
                <button key={u.id} type="button" onClick={() => toggleUser(u.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                    ${on ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-blue-500' : 'border border-gray-300'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1 truncate">{u.name || u.email}</span>
                  <span className="text-xs text-gray-400">{u.role}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            {funnelModal !== 'new' && (
              <button onClick={() => removeFunnel(funnelModal)} className="px-3 border border-red-200 text-red-500 rounded-lg py-2 text-sm hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setFunnelModal(null)} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={saveFunnel} disabled={!funnelForm.name.trim() || savingFunnel}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {savingFunnel && <Loader2 className="w-4 h-4 animate-spin" />}
              {funnelModal === 'new' ? 'Criar funil' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      {/* Cabeçalho + barra de funis */}
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl md:text-2xl font-bold">Pipeline</h1>
        {canCreateLead && (
          <button
            onClick={() => { setNewLead({ name: '', phone: '', stage_id: stages[0]?.id || '' }); setShowLeadModal(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Novo lead
          </button>
        )}
      </div>

      {/* Abas de funis */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {accessible.map(p => (
          <button key={p.id} onClick={() => switchFunnel(p.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border
              ${current?.id === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {p.name}
            {canManageFunnels && current?.id === p.id && (
              <span onClick={e => { e.stopPropagation(); openFunnelModal(p); }} className="ml-0.5 opacity-80 hover:opacity-100" title="Configurar funil">
                <Settings2 className="w-3.5 h-3.5" />
              </span>
            )}
          </button>
        ))}
        {canManageFunnels && (
          <button onClick={() => openFunnelModal('new')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-blue-500 border border-dashed border-blue-200 hover:bg-blue-50 whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /> Funil
          </button>
        )}
      </div>

      {/* Busca */}
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input placeholder="Buscar lead..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-3 md:gap-4 overflow-x-auto flex-1 pb-4 items-start snap-x snap-mandatory md:snap-none scroll-smooth px-0.5">
        {stages.map(stage => {
          const stageLeads = leads.filter(l =>
            l.stage_id === stage.id &&
            (canViewAll || l.created_by === myUserId) &&
            (!search || l.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
              l.contact?.phone?.includes(search))
          );
          const isEditing = editingStage === stage.id;

          return (
            <div key={stage.id} className="w-72 md:w-64 shrink-0 flex flex-col snap-start"
              onDragOver={e => e.preventDefault()} onDrop={() => onDrop(stage.id)}>
              <div className="flex items-center gap-2 mb-3 group">
                <button onClick={() => changeColor(stage.id)}
                  className="w-3 h-3 rounded-full shrink-0 ring-2 ring-transparent hover:ring-gray-300 transition-all"
                  style={{ background: stage.color }} />

                {isEditing && canEditStructure ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input ref={inputRef} value={editingName} onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(stage.id); if (e.key === 'Escape') setEditingStage(null); }}
                      onBlur={() => commitEdit(stage.id)}
                      className="flex-1 text-sm font-semibold bg-white border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />
                    <button onClick={() => commitEdit(stage.id)} className="text-blue-500 hover:text-blue-700"><Check className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <span onClick={e => startEdit(stage, e)}
                    className={`flex-1 text-left text-sm font-semibold text-gray-700 truncate ${canEditStructure ? 'cursor-pointer hover:text-blue-600' : 'cursor-default'}`}>
                    {stage.name}
                  </span>
                )}

                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">{stageLeads.length}</span>

                {canEditStructure && stages.length > 1 && (
                  <button onClick={() => removeStage(stage.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-1">
                {stageLeads.map(lead => (
                  <div key={lead.id}
                    draggable={canEditLead && (canViewAll || lead.created_by === myUserId)}
                    onDragStart={() => onDragStart(lead)}
                    onClick={() => setSelected(lead)}
                    className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm cursor-pointer hover:shadow-md hover:border-blue-200 transition-all">
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

        {canEditStructure && (
          <button onClick={addStage}
            className="w-52 shrink-0 h-10 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center gap-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors self-start">
            <Plus className="w-4 h-4" /> Adicionar etapa
          </button>
        )}
      </div>

      {selected && (
        <LeadPanel
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdate={async () => { await refresh(); const updated = leads.find(l => l.id === selected.id); setSelected(updated || null); }}
          onRemove={async () => { await refresh(); setSelected(null); }}
        />
      )}

      {showLeadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-bold text-lg mb-1">Novo lead</h2>
            <p className="text-xs text-gray-400 mb-4">no funil <b>{current?.name}</b></p>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Nome *</label>
            <input placeholder="Nome do contato" value={newLead.name} onChange={e => setNewLead(n => ({ ...n, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Telefone</label>
            <input placeholder="(00) 00000-0000" value={newLead.phone} onChange={e => setNewLead(n => ({ ...n, phone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Etapa</label>
            <div className="flex flex-col gap-1.5 mb-4">
              {stages.map(s => (
                <button key={s.id} type="button" onClick={() => setNewLead(n => ({ ...n, stage_id: s.id }))}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                    ${(newLead.stage_id || stages[0]?.id) === s.id ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                  {s.name}
                  {(newLead.stage_id || stages[0]?.id) === s.id && <span className="ml-auto text-blue-500">✓</span>}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowLeadModal(false)} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={createLead} disabled={!newLead.name.trim()} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Criar</button>
            </div>
          </div>
        </div>
      )}

      {funnelModal && <FunnelModal />}
    </div>
  );
}
