import { useState } from 'react';
import { X, Phone, Mail, Save, User, KanbanSquare, Plus, Trash2, ChevronDown, Hash, Calendar, List, Type } from 'lucide-react';
import { db } from '../lib/store';

const FIELD_TYPES = [
  { value: 'text',   label: 'Texto',   icon: Type },
  { value: 'number', label: 'Número',  icon: Hash },
  { value: 'date',   label: 'Data',    icon: Calendar },
  { value: 'select', label: 'Lista',   icon: List },
];

function FieldTypeIcon({ type, className }) {
  const ft = FIELD_TYPES.find(f => f.value === type);
  const Icon = ft?.icon || Type;
  return <Icon className={className} />;
}

export default function ContactPanel({ contact, onClose, onSave }) {
  const stages = db.stages.list();
  const existingLead = db.leads.list().find(l => l.contact_id === contact.id);

  const [form, setForm] = useState({
    name: contact.name || '',
    phone: contact.phone || '',
    email: contact.email || '',
  });
  const [stageId, setStageId] = useState(existingLead?.stage_id || null);
  const [fields, setFields] = useState(() => db.customFields.list());
  const [fieldValues, setFieldValues] = useState(() => contact.fields || {});
  const [saved, setSaved] = useState(false);

  // Estado do modal de novo campo
  const [showNewField, setShowNewField] = useState(false);
  const [newField, setNewField] = useState({ name: '', type: 'text', options: '' });

  function save() {
    if (!form.name.trim()) return;
    db.contacts.update(contact.id, { ...form, fields: fieldValues });

    if (stageId) {
      if (existingLead) db.leads.update(existingLead.id, { stage_id: stageId });
      else db.leads.create({ contact_id: contact.id, stage_id: stageId });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onSave?.({ ...contact, ...form, fields: fieldValues });
  }

  function createField() {
    if (!newField.name.trim()) return;
    const options = newField.type === 'select'
      ? newField.options.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    const f = db.customFields.create({ name: newField.name.trim(), type: newField.type, options });
    setFields(db.customFields.list());
    setNewField({ name: '', type: 'text', options: '' });
    setShowNewField(false);
  }

  function removeField(id) {
    if (!confirm('Remover este campo de todos os contatos?')) return;
    db.customFields.remove(id);
    setFields(db.customFields.list());
    const updated = { ...fieldValues };
    delete updated[id];
    setFieldValues(updated);
  }

  function setFieldValue(id, value) {
    setFieldValues(v => ({ ...v, [id]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="font-bold text-blue-600 text-lg">{(form.name || '?')[0].toUpperCase()}</span>
            </div>
            <p className="font-bold">{form.name || 'Contato'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Informações base */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Informações</h3>
            {[
              { key: 'name',  label: 'Nome',    placeholder: 'Nome completo',      icon: User,  type: 'text'  },
              { key: 'phone', label: 'Telefone', placeholder: '(00) 00000-0000',   icon: Phone, type: 'tel'   },
              { key: 'email', label: 'E-mail',   placeholder: 'email@exemplo.com', icon: Mail,  type: 'email' },
            ].map(({ key, label, placeholder, icon: Icon, type }) => (
              <div key={key}>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type={type} value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
            ))}
          </section>

          {/* Campos customizados */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Campos personalizados</h3>
              <button onClick={() => setShowNewField(p => !p)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus className="w-3.5 h-3.5" /> Novo campo
              </button>
            </div>

            {/* Form novo campo */}
            {showNewField && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 space-y-2">
                <input value={newField.name} onChange={e => setNewField(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do campo (ex: CPF, Empresa, Origem)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" />

                <div className="grid grid-cols-2 gap-1.5">
                  {FIELD_TYPES.map(ft => {
                    const Icon = ft.icon;
                    return (
                      <button key={ft.value} type="button"
                        onClick={() => setNewField(f => ({ ...f, type: ft.value }))}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors
                          ${newField.type === ft.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        <Icon className="w-3.5 h-3.5" /> {ft.label}
                      </button>
                    );
                  })}
                </div>

                {newField.type === 'select' && (
                  <input value={newField.options}
                    onChange={e => setNewField(f => ({ ...f, options: e.target.value }))}
                    placeholder="Opções separadas por vírgula (ex: Frio, Morno, Quente)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
                )}

                <div className="flex gap-2">
                  <button onClick={() => setShowNewField(false)}
                    className="flex-1 border border-gray-200 bg-white rounded-lg py-1.5 text-xs text-gray-500 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button onClick={createField} disabled={!newField.name.trim()}
                    className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                    Criar campo
                  </button>
                </div>
              </div>
            )}

            {fields.length === 0 && !showNewField && (
              <p className="text-xs text-gray-400 text-center py-3">Nenhum campo criado ainda</p>
            )}

            <div className="space-y-3">
              {fields.map(field => (
                <div key={field.id}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                      <FieldTypeIcon type={field.type} className="w-3 h-3 text-gray-400" />
                      {field.name}
                    </label>
                    <button onClick={() => removeField(field.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

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

          {/* Pipeline */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <KanbanSquare className="w-4 h-4 text-gray-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Pipeline</h3>
              {stageId && (
                <button onClick={() => setStageId(null)} className="ml-auto text-xs text-red-400 hover:text-red-600">
                  Remover do pipeline
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {stages.map(s => (
                <button key={s.id} type="button" onClick={() => setStageId(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                    ${stageId === s.id ? 'font-semibold' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                  style={stageId === s.id ? { background: s.color + '18', color: s.color, borderColor: s.color + '55' } : {}}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  {s.name}
                  {stageId === s.id && <span className="ml-auto text-xs">✓</span>}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <button onClick={save} disabled={!form.name.trim()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${saved ? 'bg-green-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'}`}>
            <Save className="w-4 h-4" />
            {saved ? 'Salvo!' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}
