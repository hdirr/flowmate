import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Phone, Mail, MoveRight, Trash2, Save, Plus, ChevronDown, Loader2, MessageCircle } from 'lucide-react';
import { db } from '../lib/store';

const FIELD_TYPES_CFG = [
  { value: 'text',   label: 'Texto'  },
  { value: 'number', label: 'Número' },
  { value: 'date',   label: 'Data'   },
  { value: 'select', label: 'Lista'  },
];

export default function LeadPanel({ lead, onClose, onUpdate, onRemove }) {
  const navigate = useNavigate();
  const [stages, setStages] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: lead.contact?.name || '',
    phone: lead.contact?.phone || '',
    email: lead.contact?.email || '',
  });
  const [fieldValues, setFieldValues] = useState(lead.contact?.fields || {});
  const [showNewField, setShowNewField] = useState(false);
  const [newField, setNewField] = useState({ name: '', type: 'text', options: '' });
  const [creatingField, setCreatingField] = useState(false);

  const loadData = useCallback(async () => {
    const [s, cf] = await Promise.all([db.stages.list(lead.pipeline_id), db.customFields.list()]);
    setStages(s);
    setCustomFields(cf);
    setLoading(false);
  }, [lead.pipeline_id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveContact() {
    setSaving(true);
    await db.contacts.update(lead.contact_id, { ...form, fields: fieldValues });
    setSaving(false);
    setEditing(false);
    onUpdate?.();
  }

  async function moveStage(stageId) {
    await db.leads.update(lead.id, { stage_id: stageId });
    onUpdate?.();
  }

  async function removeLead() {
    if (!confirm('Remover do pipeline? O contato continua no CRM.')) return;
    await db.leads.remove(lead.id);
    onRemove?.();
  }

  async function removeContact() {
    if (!confirm(`Excluir "${lead.contact?.name}" do CRM? Isso remove o contato e todos os leads vinculados.`)) return;
    await db.contacts.remove(lead.contact_id);
    onRemove?.();
  }

  function setFieldValue(id, value) {
    setFieldValues(v => ({ ...v, [id]: value }));
    if (!editing) setEditing(true);
  }

  async function createField() {
    if (!newField.name.trim()) return;
    setCreatingField(true);
    const options = newField.type === 'select'
      ? newField.options.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    await db.customFields.create({ name: newField.name.trim(), type: newField.type, options });
    const cf = await db.customFields.list();
    setCustomFields(cf);
    setNewField({ name: '', type: 'text', options: '' });
    setShowNewField(false);
    setCreatingField(false);
    if (!editing) setEditing(true);
  }

  const currentStage = stages.find(s => s.id === lead.stage_id);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="font-bold text-blue-600">{(lead.contact?.name || '?')[0].toUpperCase()}</span>
            </div>
            <div>
              <p className="font-bold">{lead.contact?.name}</p>
              {currentStage && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: currentStage.color + '22', color: currentStage.color }}>
                  {currentStage.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lead.contact?.phone && (
              <button
                onClick={() => { onClose(); navigate(`/chats?phone=${lead.contact.phone.replace(/\D/g, '')}`); }}
                title="Abrir chat WhatsApp"
                className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1.5 rounded-lg transition-colors font-medium">
                <MessageCircle className="w-3.5 h-3.5" /> Chat
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">

            {/* Informações do contato */}
            <section>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Informações</h3>
                {!editing
                  ? <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline">Editar</button>
                  : <div className="flex gap-2">
                      <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
                      <button onClick={saveContact} disabled={saving}
                        className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1 disabled:opacity-50">
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Salvar
                      </button>
                    </div>
                }
              </div>

              {editing ? (
                <div className="space-y-2">
                  {[
                    { key: 'name',  placeholder: 'Nome',     icon: null  },
                    { key: 'phone', placeholder: 'Telefone', icon: Phone },
                    { key: 'email', placeholder: 'E-mail',   icon: Mail  },
                  ].map(({ key, placeholder, icon: Icon }) => (
                    <div key={key} className="relative">
                      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />}
                      <input
                        value={form[key]}
                        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className={`w-full border border-gray-200 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${Icon ? 'pl-8 pr-3' : 'px-3'}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {lead.contact?.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4 text-gray-400" /> {lead.contact.phone}
                    </div>
                  )}
                  {lead.contact?.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="w-4 h-4 text-gray-400" /> {lead.contact.email}
                    </div>
                  )}
                  {!lead.contact?.phone && !lead.contact?.email && (
                    <p className="text-sm text-gray-400">Sem informações de contato</p>
                  )}
                </div>
              )}
            </section>

            {/* Campos personalizados */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Campos personalizados</h3>
                <button onClick={() => setShowNewField(p => !p)}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium">
                  <Plus className="w-3.5 h-3.5" /> Novo campo
                </button>
              </div>

              {showNewField && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 space-y-2">
                  <input value={newField.name} onChange={e => setNewField(f => ({ ...f, name: e.target.value }))}
                    placeholder="Nome do campo (ex: CPF, Empresa, Origem)"
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
                      placeholder="Opções separadas por vírgula (ex: Frio, Morno, Quente)"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setShowNewField(false)}
                      className="flex-1 border border-gray-200 bg-white rounded-lg py-1.5 text-xs text-gray-500 hover:bg-gray-50">
                      Cancelar
                    </button>
                    <button onClick={createField} disabled={!newField.name.trim() || creatingField}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      {creatingField && <Loader2 className="w-3 h-3 animate-spin" />}
                      Criar campo
                    </button>
                  </div>
                </div>
              )}

              {customFields.length === 0 && !showNewField && (
                <p className="text-xs text-gray-400 text-center py-2">Nenhum campo criado ainda</p>
              )}

              <div className="space-y-3">
                {customFields.map(field => (
                  <div key={field.id}>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">{field.name}</label>
                    {field.type === 'text' && (
                      <input type="text" value={fieldValues[field.id] || ''}
                        onChange={e => setFieldValue(field.id, e.target.value)}
                        placeholder={`Digite ${field.name.toLowerCase()}...`}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    )}
                    {field.type === 'number' && (
                      <input type="number" value={fieldValues[field.id] || ''}
                        onChange={e => setFieldValue(field.id, e.target.value)}
                        placeholder="0"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    )}
                    {field.type === 'date' && (
                      <input type="date" value={fieldValues[field.id] || ''}
                        onChange={e => setFieldValue(field.id, e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    )}
                    {field.type === 'select' && (
                      <div className="relative">
                        <select value={fieldValues[field.id] || ''}
                          onChange={e => setFieldValue(field.id, e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none bg-white pr-8">
                          <option value="">Selecionar...</option>
                          {(field.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Mover de etapa */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mover para etapa</h3>
              <div className="space-y-1.5">
                {stages.map(s => (
                  <button key={s.id} onClick={() => moveStage(s.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition-colors
                      ${lead.stage_id === s.id ? 'border-transparent font-semibold' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                    style={lead.stage_id === s.id ? { background: s.color + '18', color: s.color, borderColor: s.color + '44' } : {}}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    {s.name}
                    {lead.stage_id === s.id && <MoveRight className="w-3.5 h-3.5 ml-auto" />}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={removeLead}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm text-orange-400 hover:text-orange-600 py-2 rounded-lg hover:bg-orange-50 transition-colors border border-orange-100">
            <Trash2 className="w-4 h-4" /> Remover do pipeline
          </button>
          <button onClick={removeContact}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm text-red-400 hover:text-red-600 py-2 rounded-lg hover:bg-red-50 transition-colors border border-red-100">
            <Trash2 className="w-4 h-4" /> Excluir do CRM
          </button>
        </div>
      </div>
    </div>
  );
}
