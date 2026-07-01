import { useState, useEffect, useRef } from 'react';
import { db } from '../lib/store';
import { Send, Trash2, MessageCircle, Search, UserCog, ArrowLeft } from 'lucide-react';
import ContactPanel from '../components/ContactPanel';

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function Chats() {
  const [contacts] = useState(() => db.contacts.list());
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showPanel, setShowPanel] = useState(false);
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!selected) return;
    setNotes(db.notes.list(selected.id));
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes]);

  function send() {
    if (!text.trim() || !selected) return;
    db.notes.create(selected.id, text.trim());
    setNotes(db.notes.list(selected.id));
    setText('');
  }

  function removeNote(id) {
    db.notes.remove(id);
    setNotes(db.notes.list(selected.id));
  }

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  );

  const allNotes = (() => {
    try { return JSON.parse(localStorage.getItem('notes')) || []; } catch { return []; }
  })();

  function lastNote(contactId) {
    const n = allNotes.filter(n => n.contact_id === contactId).at(-1);
    return n ? n.text : 'Sem notas';
  }

  return (
    <div className="flex h-full relative">

      {/* Lista de contatos — sempre visível desktop, visível no mobile só se não tiver selecionado */}
      <div className={`
        w-full md:w-72 shrink-0 border-r border-gray-100 flex flex-col bg-white
        ${selected ? 'hidden md:flex' : 'flex'}
      `}>
        <div className="p-4 border-b border-gray-100">
          <h1 className="text-lg font-bold mb-3">Chats</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Buscar contato..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">Nenhum contato</div>
          )}
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 hover:bg-gray-50 transition-colors
                ${selected?.id === c.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-blue-600">{c.name[0].toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-xs text-gray-400 truncate">{lastNote(c.id)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Área de chat — tela cheia no mobile quando selecionado */}
      {selected ? (
        <div className={`
          flex-1 flex flex-col bg-gray-50
          absolute inset-0 md:static
          ${selected ? 'flex' : 'hidden md:flex'}
        `}>
          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
            {/* Botão voltar — só mobile */}
            <button
              onClick={() => setSelected(null)}
              className="md:hidden text-gray-400 hover:text-gray-700 mr-1"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-blue-600">{selected.name[0].toUpperCase()}</span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{selected.name}</p>
              <p className="text-xs text-gray-400">{selected.phone || selected.email || 'Sem contato'}</p>
            </div>
            <button onClick={() => setShowPanel(true)} className="text-gray-400 hover:text-blue-500 transition-colors" title="Editar contato">
              <UserCog className="w-5 h-5" />
            </button>
          </div>

          {showPanel && (
            <ContactPanel
              contact={selected}
              onClose={() => setShowPanel(false)}
              onSave={(updated) => { setSelected(updated); setShowPanel(false); }}
            />
          )}

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-2">
            {notes.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma nota ainda. Comece digitando abaixo.</p>
              </div>
            )}
            {notes.map(note => (
              <div key={note.id} className="flex justify-end group">
                <div className="relative max-w-xs md:max-w-sm">
                  <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm shadow-sm">
                    {note.text}
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <span className="text-xs text-gray-400">{timeLabel(note.created_at)}</span>
                    <button
                      onClick={() => removeNote(note.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-gray-100 p-3 md:p-4 flex gap-2 md:gap-3">
            <input
              placeholder="Escreva uma nota..."
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={send}
              disabled={!text.trim()}
              className="bg-blue-600 text-white rounded-xl px-4 flex items-center gap-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-gray-400 bg-gray-50">
          <div className="text-center">
            <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Selecione um contato para ver as notas</p>
          </div>
        </div>
      )}
    </div>
  );
}
