import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/store';
import { supabase } from '../lib/supabase';
import { auth, userStore, ROLE_LABELS } from '../lib/auth';
import {
  Plus, Trash2, Bot, Zap, X, ToggleLeft, ToggleRight,
  ArrowDown, KanbanSquare, MessageCircle, StickyNote, Tag,
  UserPlus, Mail, Bell, Clock, Webhook, Star, UserMinus, AlertCircle, Play,
  ChevronUp, ChevronDown, PenLine, Paperclip, Loader2, FileText
} from 'lucide-react';

const TRIGGERS = [
  { value: 'lead_entered_stage', label: 'Lead entrar em uma etapa',      icon: KanbanSquare, color: '#6366f1', desc: 'Dispara quando um lead chega numa etapa específica' },
  { value: 'lead_moved_stage',   label: 'Lead ser movido de etapa',      icon: KanbanSquare, color: '#3b82f6', desc: 'Dispara ao arrastar o lead para outra etapa' },
  { value: 'contact_created',    label: 'Novo contato criado',           icon: UserPlus,     color: '#10b981', desc: 'Dispara ao cadastrar um novo contato' },
  { value: 'lead_inactive',      label: 'Lead sem atividade por X dias', icon: Clock,        color: '#f59e0b', desc: 'Dispara quando nenhuma ação é feita por N dias' },
  { value: 'tag_added',          label: 'Tag adicionada ao contato',     icon: Tag,          color: '#ec4899', desc: 'Dispara ao marcar um contato com uma tag' },
  { value: 'lead_lost',          label: 'Lead marcado como perdido',     icon: UserMinus,    color: '#ef4444', desc: 'Dispara quando um lead é removido do pipeline' },
];

const ACTIONS = [
  { value: 'send_whatsapp', label: 'Enviar WhatsApp',    icon: MessageCircle, color: '#25d366' },
  { value: 'send_email',    label: 'Enviar e-mail',      icon: Mail,          color: '#6366f1' },
  { value: 'add_note',      label: 'Nota interna',       icon: StickyNote,    color: '#f59e0b' },
  { value: 'notify_team',   label: 'Notificar equipe',   icon: Bell,          color: '#8b5cf6' },
  { value: 'move_stage',    label: 'Mover etapa',        icon: KanbanSquare,  color: '#3b82f6' },
  { value: 'add_tag',       label: 'Adicionar tag',      icon: Tag,           color: '#ec4899' },
  { value: 'mark_priority', label: 'Marcar prioritário', icon: Star,          color: '#f59e0b' },
  { value: 'wait_days',     label: 'Aguardar dias',      icon: Clock,         color: '#6b7280' },
  { value: 'webhook',       label: 'Webhook',            icon: Webhook,       color: '#0ea5e9' },
  { value: 'alert_overdue', label: 'Alertar atraso',     icon: AlertCircle,   color: '#ef4444' },
  { value: 'set_field',    label: 'Alterar campo',      icon: PenLine,       color: '#0891b2' },
];

function uid() { return Math.random().toString(36).slice(2); }
const EMPTY = { name: '', trigger: '', triggerStageId: '', triggerDays: 3, actions: [] };

const FIELD_TYPES_CFG = [
  { value: 'text',   label: 'Texto'  },
  { value: 'number', label: 'Número' },
  { value: 'date',   label: 'Data'   },
  { value: 'select', label: 'Lista'  },
];

function StepConfig({ action, onChange, stages }) {
  const [fields, setFields] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newField, setNewField] = useState({ name: '', type: 'text', options: '' });
  const [uploadingMedia, setUploadingMedia] = useState(false);

  useEffect(() => { db.customFields.list().then(setFields); }, []);

  async function uploadMedia(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { alert('Arquivo muito grande. Máximo 16MB.'); return; }
    setUploadingMedia(true);
    try {
      const companyId = auth.currentCompanyId();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${companyId}/bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('whatsapp-media').upload(path, file, { contentType: file.type });
      if (error) { alert('Erro ao subir arquivo: ' + error.message); return; }
      const { data: pub } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
      const mediaType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
      onChange({ ...action, mediaUrl: pub.publicUrl, mediaType, mimeType: file.type, fileName: file.name });
    } finally {
      setUploadingMedia(false);
    }
  }

  async function createField() {
    if (!newField.name.trim()) return;
    const options = newField.type === 'select'
      ? newField.options.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    const f = await db.customFields.create({ name: newField.name.trim(), type: newField.type, options });
    const updated = await db.customFields.list();
    setFields(updated);
    if (f) onChange({ ...action, fieldId: f.id, fieldValue: '' });
    setNewField({ name: '', type: 'text', options: '' });
    setShowCreate(false);
  }

  const hasTextBody = ['send_whatsapp', 'send_email', 'add_note', 'notify_team', 'webhook'].includes(action.type);

  return (
    <div className="mt-2 space-y-2">
      {hasTextBody && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            {action.type === 'send_email' ? 'Corpo do e-mail' :
             action.type === 'webhook'    ? 'URL do Webhook' : 'Mensagem'}
          </label>
          {action.type === 'webhook' ? (
            <input value={action.body || ''} onChange={e => onChange({ ...action, body: e.target.value })}
              placeholder="https://..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          ) : (
            <>
              <textarea value={action.body || ''} onChange={e => onChange({ ...action, body: e.target.value })}
                placeholder={action.type === 'send_whatsapp' ? 'Olá {nome}, tudo bem?' : action.type === 'add_note' ? 'Ex: Lead qualificado automaticamente' : 'Mensagem...'}
                rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              <p className="text-xs text-gray-300 mt-0.5">Use <span className="font-mono bg-gray-100 px-1 rounded text-gray-400">{'{nome}'}</span> para personalizar</p>
            </>
          )}
        </div>
      )}

      {/* Anexo opcional para WhatsApp */}
      {action.type === 'send_whatsapp' && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Anexo (opcional)</label>
          {action.mediaUrl ? (
            <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <FileText className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm text-green-700 truncate flex-1">{action.fileName || 'Anexo'}</span>
              <button type="button" onClick={() => onChange({ ...action, mediaUrl: undefined, mediaType: undefined, mimeType: undefined, fileName: undefined })}
                className="text-gray-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <label className={`flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${uploadingMedia ? 'opacity-60' : ''}`}>
              {uploadingMedia ? <Loader2 className="w-4 h-4 animate-spin text-green-500" /> : <Paperclip className="w-4 h-4 text-gray-400" />}
              <span className="text-gray-500">{uploadingMedia ? 'Enviando...' : 'Anexar foto, vídeo ou PDF'}</span>
              <input type="file" accept="image/*,video/*,application/pdf" onChange={uploadMedia} disabled={uploadingMedia} className="hidden" />
            </label>
          )}
        </div>
      )}

      {action.type === 'send_email' && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Assunto</label>
          <input value={action.subject || ''} onChange={e => onChange({ ...action, subject: e.target.value })}
            placeholder="Ex: Proposta para {nome}" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
      )}

      {action.type === 'move_stage' && (
        <div>
          <label className="text-xs text-gray-400 mb-1.5 block">Mover para</label>
          <div className="grid grid-cols-2 gap-1.5">
            {stages.map(s => (
              <button key={s.id} type="button" onClick={() => onChange({ ...action, stageId: s.id })}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs text-left transition-all
                  ${action.stageId === s.id ? 'font-semibold border-2' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                style={action.stageId === s.id ? { borderColor: s.color, background: s.color + '12', color: s.color } : {}}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {action.type === 'add_tag' && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Nome da tag</label>
          <input value={action.tag || ''} onChange={e => onChange({ ...action, tag: e.target.value })}
            placeholder="Ex: vip, urgente, qualificado"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
      )}

      {action.type === 'wait_days' && (
        <div className="flex items-center gap-3">
          <input type="number" min={1} max={365} value={action.days || 1}
            onChange={e => onChange({ ...action, days: Number(e.target.value) })}
            className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <span className="text-sm text-gray-500">dia{action.days !== 1 ? 's' : ''} antes do próximo passo</span>
        </div>
      )}

      {action.type === 'set_field' && (
        <div className="space-y-2">
          {/* Seletor de campo + botão criar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">Campo a alterar</label>
              <button type="button" onClick={() => setShowCreate(p => !p)}
                className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium">
                <Plus className="w-3 h-3" /> {showCreate ? 'Cancelar' : 'Novo campo'}
              </button>
            </div>

            {/* Mini-form criar campo */}
            {showCreate && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-2 space-y-2">
                <input value={newField.name} onChange={e => setNewField(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do campo (ex: Origem, Empresa)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <div className="grid grid-cols-2 gap-1.5">
                  {FIELD_TYPES_CFG.map(ft => (
                    <button key={ft.value} type="button"
                      onClick={() => setNewField(f => ({ ...f, type: ft.value }))}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-colors
                        ${newField.type === ft.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {ft.label}
                    </button>
                  ))}
                </div>
                {newField.type === 'select' && (
                  <input value={newField.options} onChange={e => setNewField(f => ({ ...f, options: e.target.value }))}
                    placeholder="Opções: Frio, Morno, Quente"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                )}
                <button onClick={createField} disabled={!newField.name.trim()}
                  className="w-full bg-blue-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                  Criar e selecionar campo
                </button>
              </div>
            )}

            {fields.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg">
                Clique em "Novo campo" para criar o primeiro campo personalizado.
              </p>
            ) : (
              <select value={action.fieldId || ''} onChange={e => onChange({ ...action, fieldId: e.target.value, fieldValue: '' })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="">Selecionar campo...</option>
                {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({FIELD_TYPES_CFG.find(t => t.value === f.type)?.label})</option>)}
              </select>
            )}
          </div>

          {/* Valor a definir */}
          {action.fieldId && (() => {
            const field = fields.find(f => f.id === action.fieldId);
            if (!field) return null;
            return (
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Definir valor para "{field.name}"</label>
                {field.type === 'select' ? (
                  <select value={action.fieldValue || ''} onChange={e => onChange({ ...action, fieldValue: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                    <option value="">Selecionar...</option>
                    {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={action.fieldValue || ''} onChange={e => onChange({ ...action, fieldValue: e.target.value })}
                    placeholder={`Novo valor para ${field.name}`}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Picker de ações — grid de botões para adicionar
function ActionPicker({ onAdd }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-3 bg-white rounded-xl border border-gray-100 shadow-lg">
      {ACTIONS.map(a => {
        const Icon = a.icon;
        return (
          <button key={a.value} type="button" onClick={() => onAdd(a.value)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors">
            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: a.color + '20' }}>
              <Icon className="w-3.5 h-3.5" style={{ color: a.color }} />
            </div>
            <span className="text-xs font-medium text-gray-700">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Automations() {
  const session = auth.session();
  const canView    = auth.can('automations', 'view');
  const canCreate  = auth.can('automations', 'create');
  const canExecute = auth.can('automations', 'execute');
  const canEditPerm   = auth.can('automations', 'edit');
  const canRemovePerm = auth.can('automations', 'remove');

  const myUserId = session?.user?.id;
  const myRole = session?.user?.role || auth.profile?.()?.role;

  // Hierarquia de papéis: admin > manager > seller
  const ROLE_RANK = { admin: 3, manager: 2, seller: 1 };
  function canEditWf(wf) {
    if (!canEditPerm) return false;
    if (!wf.created_by) return true; // legado sem dono
    if (wf.created_by === myUserId) return true;
    // pode editar se meu rank for maior que o criador
    const creator = users.find(u => u.id === wf.created_by);
    const myRank = ROLE_RANK[myRole] || 0;
    const creatorRank = ROLE_RANK[creator?.role] || 0;
    return myRank > creatorRank;
  }
  function canRemoveWf(wf) {
    if (!canRemovePerm) return false;
    if (!wf.created_by) return true;
    if (wf.created_by === myUserId) return true;
    const creator = users.find(u => u.id === wf.created_by);
    const myRank = ROLE_RANK[myRole] || 0;
    const creatorRank = ROLE_RANK[creator?.role] || 0;
    return myRank > creatorRank;
  }

  const [stages, setStages] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState(1);
  const [showPicker, setShowPicker] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const refresh = useCallback(async () => {
    const [w, s] = await Promise.all([db.workflows.list(), db.stages.list()]);
    setWorkflows(w);
    setStages(s);
  }, []);

  // Carrega usuários (para hierarquia de permissão) — async, sem travar o render
  useEffect(() => { userStore.list().then(setUsers).catch(() => setUsers([])); }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener('flowmate:update', refresh);
    return () => window.removeEventListener('flowmate:update', refresh);
  }, [refresh]);

  async function openNew() { const s = await db.stages.list(); setStages(s); setForm(EMPTY); setStep(1); setShowPicker(false); setModal('new'); }
  async function openEdit(wf) {
    const s = await db.stages.list();
    setStages(s);
    // Mapeia o formato do banco (trigger_type/trigger_config) para o formato do form
    setForm({
      id: wf.id,
      name: wf.name || '',
      trigger: wf.trigger || wf.trigger_type || '',
      triggerStageId: wf.triggerStageId || wf.trigger_config?.stage_id || '',
      triggerDays: wf.triggerDays || wf.trigger_config?.days || 3,
      actions: wf.actions || [],
    });
    setStep(1); setShowPicker(false); setModal(wf);
  }

  async function toggleEnabled(wf) { await db.workflows.update(wf.id, { enabled: !wf.enabled }); await refresh(); }
  async function remove(id) { if (!confirm('Remover automação?')) return; await db.workflows.remove(id); await refresh(); }

  // Ações — agora permite duplicatas (múltiplos passos do mesmo tipo)
  function addAction(type) {
    if (form.actions.length >= 10) return;
    setForm(f => ({ ...f, actions: [...f.actions, { id: uid(), type, body: '', subject: '', days: 1 }] }));
    setShowPicker(false);
  }
  function removeAction(idx) { setForm(f => ({ ...f, actions: f.actions.filter((_, i) => i !== idx) })); }
  function updateAction(idx, updated) { setForm(f => ({ ...f, actions: f.actions.map((a, i) => i === idx ? updated : a) })); }
  function moveAction(idx, dir) {
    setForm(f => {
      const arr = [...f.actions];
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return f;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return { ...f, actions: arr };
    });
  }

  async function runNow(wf) {
    for (const action of wf.actions) {
      if (action.type === 'move_stage' && !action.stageId) {
        setRunResult({ wfId: wf.id, error: 'Ação "Mover etapa" sem etapa destino. Clique em Editar e selecione a etapa.' });
        return;
      }
    }
    const leads = await db.leads.list();
    const stageId = wf.triggerStageId || wf.trigger_config?.stage_id;
    const stageLeads = stageId ? leads.filter(l => l.stage_id === stageId) : leads;
    if (stageLeads.length === 0) { setRunResult({ wfId: wf.id, error: 'Nenhum lead encontrado na etapa configurada.' }); return; }

    // Token e instância para envio real de WhatsApp
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const instanceName = `flowmate-${auth.currentCompanyId()}`;

    for (const lead of stageLeads) {
      for (const action of wf.actions) {
        if (action.type === 'move_stage' && action.stageId) await db.leads.update(lead.id, { stage_id: action.stageId });
        if ((action.type === 'add_note' || action.type === 'notify_team') && action.body) await db.notes.create(lead.contact_id, action.body);
        if (action.type === 'add_tag' && action.tag) {
          const tags = [...(lead.contact?.tags || []).filter(t => t !== action.tag), action.tag];
          await db.contacts.update(lead.contact_id, { tags });
        }
        if (action.type === 'send_whatsapp' && (action.body || action.mediaUrl) && token) {
          let phone = (lead.contact?.phone || '').replace(/\D/g, '');
          if (phone) {
            if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = '55' + phone;
            const msg = (action.body || '').replace(/\{nome\}/gi, lead.contact?.name || '');
            if (action.mediaUrl) {
              await fetch('/api/whatsapp/send-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ to: phone, mediaUrl: action.mediaUrl, mediaType: action.mediaType, mimeType: action.mimeType, fileName: action.fileName, caption: msg || undefined, instanceName }),
              }).catch(() => {});
            } else {
              await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ to: phone, message: msg, instanceName }),
              }).catch(() => {});
            }
          }
        }
        if (action.type === 'webhook' && action.body) {
          fetch(action.body, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: lead.id }) }).catch(() => {});
        }
        if (action.type === 'set_field' && action.fieldId && lead.contact_id) {
          const contacts = await db.contacts.list();
          const c = contacts.find(x => x.id === lead.contact_id);
          if (c) await db.contacts.update(lead.contact_id, { fields: { ...(c.fields || {}), [action.fieldId]: action.fieldValue || '' } });
        }
      }
    }

    window.dispatchEvent(new Event('flowmate:update'));
    setRunResult({ wfId: wf.id, ok: true, count: stageLeads.length });
    setTimeout(() => setRunResult(null), 3000);
  }

  async function save() {
    if (!form.name.trim()) return;
    if (modal === 'new') await db.workflows.create(form);
    else await db.workflows.update(form.id, form);
    await refresh(); setModal(null);
  }

  const needsStage = form.trigger === 'lead_entered_stage' || form.trigger === 'lead_moved_stage';

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Automações</h1>
          <p className="text-sm text-gray-400 mt-0.5">Robôs que trabalham por você automaticamente</p>
        </div>
        {canCreate && (
          <button onClick={openNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-blue-700 shadow-sm">
            <Plus className="w-4 h-4" /> Nova
          </button>
        )}
      </div>

      {workflows.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8 text-gray-300" />
          </div>
          <p className="font-semibold text-gray-500">Nenhuma automação criada</p>
          <p className="text-sm text-gray-400 mt-1 mb-5">Crie robôs para automatizar tarefas repetitivas</p>
          <button onClick={openNew} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
            Criar primeira automação
          </button>
        </div>
      )}

      <div className="space-y-3">
        {workflows.filter(wf => canView || wf.created_by === myUserId).map(wf => {
          const wfTrigger = wf.trigger || wf.trigger_type;
          const wfStageId = wf.triggerStageId || wf.trigger_config?.stage_id;
          const trig = TRIGGERS.find(t => t.value === wfTrigger);
          const TrigIcon = trig?.icon || Zap;
          return (
            <div key={wf.id} className={`bg-white rounded-2xl border p-4 transition-all ${wf.enabled ? 'border-blue-100 shadow-sm' : 'border-gray-100 opacity-70'}`}>
              {runResult?.wfId === wf.id && (
                <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 ${runResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {runResult.ok ? `✅ ${runResult.count} lead${runResult.count > 1 ? 's executados' : ' executado'} com sucesso!` : `⚠️ ${runResult.error}`}
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: (trig?.color || '#6366f1') + '18' }}>
                  <TrigIcon className="w-5 h-5" style={{ color: trig?.color || '#6366f1' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{wf.name || 'Sem nome'}</span>
                    {wf.enabled
                      ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-medium">Ativo</span>
                      : <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inativo</span>}
                    {wf.actions.length > 0 && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{wf.actions.length} passo{wf.actions.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-400 uppercase">Se</span>
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-lg font-medium">
                      {trig?.label || '—'}
                      {wfStageId && <> → <b>{stages.find(s => s.id === wfStageId)?.name}</b></>}
                    </span>
                    {wf.actions.length > 0 && (
                      <>
                        <span className="text-xs font-semibold text-gray-400 uppercase">então</span>
                        <div className="flex gap-1 flex-wrap">
                          {wf.actions.map((a, i) => {
                            const act = ACTIONS.find(x => x.value === a.type);
                            if (!act) return null;
                            const AIcon = act.icon;
                            return (
                              <span key={i} className="text-xs px-2 py-0.5 rounded-lg font-medium flex items-center gap-1"
                                style={{ background: act.color + '18', color: act.color }}>
                                {a.type === 'wait_days'
                                  ? <><Clock className="w-3 h-3" /> {a.days}d</>
                                  : <><AIcon className="w-3 h-3" />{act.label}</>}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {wf.enabled && canExecute && (
                    <button onClick={() => runNow(wf)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-green-600 hover:bg-green-50 transition-colors">
                      <Play className="w-3.5 h-3.5" /> Executar
                    </button>
                  )}
                  {canEditWf(wf) && (
                    <button onClick={() => toggleEnabled(wf)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                      {wf.enabled ? <ToggleRight className="w-6 h-6 text-blue-500" /> : <ToggleLeft className="w-6 h-6 text-gray-300" />}
                    </button>
                  )}
                  {canEditWf(wf) && (
                    <button onClick={() => openEdit(wf)} className="p-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors font-medium">Editar</button>
                  )}
                  {canRemoveWf(wf) && (
                    <button onClick={() => remove(wf.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== MODAL ===== */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) { setShowPicker(false); setModal(null); } }}>
          <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">

            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-base">{modal === 'new' ? 'Nova automação' : 'Editar automação'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {step === 1 ? 'Passo 1 de 3 — Escolha o gatilho'
                   : step === 2 ? 'Passo 2 de 3 — Monte a sequência de ações'
                   : 'Passo 3 de 3 — Dê um nome'}
                </p>
              </div>
              <button onClick={() => setModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="h-1 bg-gray-100">
              <div className="h-1 bg-blue-500 transition-all duration-300" style={{ width: `${(step / 3) * 100}%` }} />
            </div>

            <div className="flex-1 overflow-y-auto p-5">

              {/* STEP 1 — Gatilho */}
              {step === 1 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-600 mb-3">Quando isso acontecer...</p>
                  {TRIGGERS.map(t => {
                    const Icon = t.icon;
                    const active = form.trigger === t.value;
                    return (
                      <button key={t.value} type="button"
                        onClick={() => setForm(f => ({ ...f, trigger: t.value, triggerStageId: '' }))}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all
                          ${active ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                      >
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.color + '20' }}>
                          <Icon className="w-5 h-5" style={{ color: t.color }} />
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-700'}`}>{t.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
                        </div>
                        {active && <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />}
                      </button>
                    );
                  })}

                  {needsStage && (
                    <div className="mt-2 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">Em qual etapa? <span className="text-gray-300">(opcional)</span></p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {stages.map(s => (
                          <button key={s.id} type="button"
                            onClick={() => setForm(f => ({ ...f, triggerStageId: f.triggerStageId === s.id ? '' : s.id }))}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium text-left transition-all
                              ${form.triggerStageId === s.id ? 'border-2' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                            style={form.triggerStageId === s.id ? { borderColor: s.color, background: s.color + '12', color: s.color } : {}}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                            <span className="truncate">{s.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {form.trigger === 'lead_inactive' && (
                    <div className="mt-2 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">Dias sem atividade</p>
                      <div className="flex items-center gap-2">
                        <input type="number" min={1} max={90} value={form.triggerDays || 3}
                          onChange={e => setForm(f => ({ ...f, triggerDays: Number(e.target.value) }))}
                          className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        <span className="text-sm text-gray-400">dias sem movimentação</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2 — Sequência de ações */}
              {step === 2 && (
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Monte a sequência de passos</p>
                  <p className="text-xs text-gray-400 mb-4">Os passos são executados em ordem. Use "Aguardar dias" para criar delays entre eles.</p>

                  {/* Sequência visual */}
                  <div className="space-y-0">
                    {form.actions.length === 0 && (
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm mb-3">
                        Nenhum passo ainda — clique em "+ Adicionar passo" abaixo
                      </div>
                    )}

                    {form.actions.map((action, idx) => {
                      const def = ACTIONS.find(a => a.value === action.type);
                      const Icon = def?.icon || Zap;
                      const isWait = action.type === 'wait_days';

                      return (
                        <div key={action.id || idx}>
                          {/* Card do passo */}
                          <div className={`relative rounded-xl border p-3 ${isWait ? 'bg-gray-50 border-dashed border-gray-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                            {/* Número do passo */}
                            {!isWait && (
                              <div className="absolute -left-3 -top-2 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shadow">
                                {idx + 1 - form.actions.slice(0, idx).filter(a => a.type === 'wait_days').length}
                              </div>
                            )}

                            <div className="flex items-start gap-2">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                                style={{ background: (def?.color || '#888') + '20' }}>
                                <Icon className="w-4 h-4" style={{ color: def?.color }} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-700">{def?.label}</span>
                                <StepConfig action={action} onChange={u => updateAction(idx, u)} stages={stages} />
                              </div>

                              {/* Reordenar + remover */}
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button onClick={() => moveAction(idx, -1)} disabled={idx === 0}
                                  className="p-0.5 rounded text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
                                  <ChevronUp className="w-4 h-4" />
                                </button>
                                <button onClick={() => moveAction(idx, 1)} disabled={idx === form.actions.length - 1}
                                  className="p-0.5 rounded text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
                                  <ChevronDown className="w-4 h-4" />
                                </button>
                                <button onClick={() => removeAction(idx)} className="p-0.5 rounded text-gray-200 hover:text-red-400 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Conector entre passos */}
                          {idx < form.actions.length - 1 && (
                            <div className="flex justify-center my-1">
                              <ArrowDown className="w-4 h-4 text-gray-300" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Botão adicionar passo */}
                  <div className="mt-4 relative">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs font-medium ${form.actions.length >= 10 ? 'text-red-500' : 'text-gray-400'}`}>
                        {form.actions.length}/10 passos
                      </span>
                      {form.actions.length >= 10 && (
                        <span className="text-xs text-red-400">Limite máximo atingido</span>
                      )}
                    </div>
                    <button
                      onClick={() => setShowPicker(p => !p)}
                      disabled={form.actions.length >= 10}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed rounded-xl text-sm font-medium transition-colors
                        disabled:border-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed
                        border-blue-200 text-blue-500 hover:border-blue-400 hover:bg-blue-50"
                    >
                      <Plus className="w-4 h-4" /> Adicionar passo
                    </button>

                    {showPicker && (
                      <div className="mt-2 z-10">
                        <ActionPicker onAdd={addAction} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3 — Nome */}
              {step === 3 && (
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-3">Dê um nome para este robô</p>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Sequência de follow-up"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && form.name.trim() && save()}
                  />

                  {/* Resumo visual da sequência */}
                  <div className="mt-4 bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Resumo</p>

                    {/* Gatilho */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <Zap className="w-3.5 h-3.5 text-indigo-500" />
                      </div>
                      <span className="text-xs text-gray-600">
                        <b>GATILHO:</b> {TRIGGERS.find(t => t.value === form.trigger)?.label}
                        {form.triggerStageId && <> em <b>{stages.find(s => s.id === form.triggerStageId)?.name}</b></>}
                      </span>
                    </div>

                    {/* Passos */}
                    {form.actions.map((a, i) => {
                      const act = ACTIONS.find(x => x.value === a.type);
                      const AIcon = act?.icon || Zap;
                      const isWait = a.type === 'wait_days';
                      return (
                        <div key={i} className="flex items-start gap-2 mt-1.5">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="w-px h-2 bg-gray-200" />
                            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: (act?.color || '#888') + '20' }}>
                              <AIcon className="w-3.5 h-3.5" style={{ color: act?.color }} />
                            </div>
                          </div>
                          <span className="text-xs text-gray-600 pt-2.5">
                            {isWait ? <><b>AGUARDAR</b> {a.days} dia{a.days > 1 ? 's' : ''}</> : <><b>PASSO {i + 1 - form.actions.slice(0, i).filter(x => x.type === 'wait_days').length}:</b> {act?.label}{a.body ? ` — "${a.body.slice(0, 30)}${a.body.length > 30 ? '…' : ''}"` : ''}</>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
              {step > 1 && (
                <button onClick={() => { setStep(s => s - 1); setShowPicker(false); }}
                  className="px-4 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                  Voltar
                </button>
              )}
              {step < 3 && (
                <button
                  onClick={() => { setStep(s => s + 1); setShowPicker(false); }}
                  disabled={(step === 1 && !form.trigger) || (step === 2 && form.actions.length === 0)}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
                >
                  Próximo
                </button>
              )}
              {step === 3 && (
                <button onClick={save} disabled={!form.name.trim()}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                  {modal === 'new' ? 'Criar robô' : 'Salvar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
