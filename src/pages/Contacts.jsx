import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/store';
import { auth } from '../lib/auth';
import { Plus, Search, User, Phone, Mail, Trash2, X, KanbanSquare, Upload } from 'lucide-react';
import ContactPanel from '../components/ContactPanel';
import ImportModal from '../components/ImportModal';

const EMPTY = { name: '', phone: '', email: '', stage_id: null };

export default function Contacts() {
  const session = auth.session();
  const canCreate  = auth.can('contacts', 'create');
  const canRemove  = auth.can('contacts', 'remove');
  const canViewAll = auth.can('contacts', 'view_all');
  const canImport  = auth.can('import', 'access');

  const [stages, setStages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [allLeads, setAllLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [panel, setPanel] = useState(null);

  const refresh = useCallback(async () => {
    const [c, s, l] = await Promise.all([db.contacts.list(), db.stages.list(), db.leads.list()]);
    setContacts(c);
    setStages(s);
    setAllLeads(l);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener('flowmate:update', refresh);
    return () => window.removeEventListener('flowmate:update', refresh);
  }, [refresh]);

  async function save() {
    if (!form.name.trim()) return;
    const contact = await db.contacts.create({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    });
    if (contact && form.stage_id) {
      await db.leads.create({ contact_id: contact.id, stage_id: form.stage_id });
    }
    await refresh();
    setShowModal(false);
    setForm(EMPTY);
  }

  async function remove(id) {
    if (!confirm('Remover contato?')) return;
    await db.contacts.remove(id);
    await refresh();
  }

  const filtered = contacts
    .filter(c => canViewAll || c.created_by === session?.user?.id)
    .filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase())
    );

  function contactStage(contactId) {
    const lead = allLeads.find(l => l.contact_id === contactId);
    return lead ? stages.find(s => s.id === lead.stage_id) : null;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-xl md:text-2xl font-bold">Contatos</h1>
        <div className="flex gap-2">
          {canImport && (
            <button onClick={() => setShowImport(true)}
              className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-gray-50">
              <Upload className="w-4 h-4" /> Importar
            </button>
          )}
          {canCreate && (
            <button onClick={() => { setForm(EMPTY); setShowModal(true); }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Novo contato
            </button>
          )}
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          placeholder="Buscar por nome, telefone ou e-mail..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>{search ? 'Nenhum contato encontrado' : 'Nenhum contato ainda'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filtered.map((c, i) => {
            const stage = contactStage(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-blue-600">{c.name[0].toUpperCase()}</span>
                </div>
                <button className="flex-1 min-w-0 text-left" onClick={() => setPanel(c)}>
                  <p className="font-semibold text-sm hover:text-blue-600 transition-colors">{c.name}</p>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    {c.phone && <span className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                    {c.email && <span className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                    {stage && (
                      <span className="text-xs flex items-center gap-1 font-medium" style={{ color: stage.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
                        {stage.name}
                      </span>
                    )}
                  </div>
                </button>
                {canRemove && (canViewAll || c.created_by === session?.user?.id) && (
                  <button onClick={() => remove(c.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">{contacts.length} contato{contacts.length !== 1 ? 's' : ''} no total</p>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={refresh} />}

      {panel && (
        <ContactPanel
          contact={panel}
          onClose={() => setPanel(null)}
          onSave={async () => { await refresh(); setPanel(null); }}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg">Novo contato</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {[
              { key: 'name',  label: 'Nome *',   placeholder: 'Nome completo',      type: 'text'  },
              { key: 'phone', label: 'Telefone',  placeholder: '(00) 00000-0000',   type: 'tel'   },
              { key: 'email', label: 'E-mail',    placeholder: 'email@exemplo.com',  type: 'email' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key} className="mb-3">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">{label}</label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  autoFocus={key === 'name'}
                />
              </div>
            ))}

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <KanbanSquare className="w-3.5 h-3.5" /> Pipeline <span className="text-gray-300 font-normal">(opcional)</span>
              </label>
              <div className="space-y-1.5">
                {stages.map(s => (
                  <button key={s.id} type="button"
                    onClick={() => setForm(f => ({ ...f, stage_id: f.stage_id === s.id ? null : s.id }))}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                      ${form.stage_id === s.id ? 'font-semibold' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                    style={form.stage_id === s.id ? { background: s.color + '18', color: s.color, borderColor: s.color + '55' } : {}}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    {s.name}
                    {form.stage_id === s.id && <span className="ml-auto">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={save} disabled={!form.name.trim()} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
