import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/store';
import { auth } from '../lib/auth';
import { Send, Search, MessageCircle, Wifi, WifiOff, Loader2, RefreshCw, Paperclip, FileText, X, UserCog, Bot } from 'lucide-react';
import ContactPanel from '../components/ContactPanel';

function timeLabel(ts) {
  const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function normalizePhone(jid) {
  return jid.replace(/@.*/, '').replace(/\D/g, '');
}

// Garante número no formato internacional pro WhatsApp (adiciona 55 se faltar)
function toWhatsAppNumber(digits) {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

// Dois telefones representam o mesmo contato? Compara pelos últimos 8 dígitos
function samePhone(a, b) {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (!da || !db) return false;
  return da.endsWith(db) || db.endsWith(da) || da.slice(-8) === db.slice(-8);
}

function groupByContact(messages, contacts) {
  // Agrupa por CONTATO (não por JID), usando casamento por sufixo de telefone.
  // Isso une mensagens enviadas (com 9) e recebidas (sem 9) do mesmo contato,
  // e só mostra contatos cadastrados no CRM.
  const withPhone = contacts.filter(c => c.phone);
  const map = {};

  for (const msg of messages) {
    const phone = normalizePhone(msg.remote_jid);
    const contact = withPhone.find(c => samePhone(c.phone, phone));
    if (!contact) continue;

    const key = contact.id;
    if (!map[key]) {
      map[key] = {
        jid: msg.remote_jid,
        phone: toWhatsAppNumber(contact.phone),
        name: contact.name,
        contact,
        messages: [],
        last: msg,
      };
    }
    map[key].messages.push(msg);
    if (msg.timestamp > map[key].last.timestamp) map[key].last = msg;
  }
  return Object.values(map).sort((a, b) => b.last.timestamp - a.last.timestamp);
}

export default function Chats() {
  const [searchParams] = useSearchParams();
  const autoSelectedRef = useRef(null);
  const [instance, setInstance] = useState(null);
  const [loadingInstance, setLoadingInstance] = useState(true);
  const [messages, setMessages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [convState, setConvState] = useState(null);   // { state, state_since, state_by }
  const [resuming, setResuming] = useState(false);
  const [search, setSearch] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesRef = useRef([]);
  const contactsRef = useRef([]);
  const canSend = auth.can('chats', 'send');

  // Mantém refs sincronizados pro polling ler valores atuais sem recriar o intervalo
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  const loadInstance = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/whatsapp/status', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInstance(data.status === 'connected' ? data : null);
    } else {
      setInstance(null);
    }
    setLoadingInstance(false);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!instance) return;
    const instName = instance.instance_name || instance.instanceName;
    const [{ data: msgs }, crm] = await Promise.all([
      supabase.from('whatsapp_messages').select('*').eq('instance_name', instName).order('timestamp', { ascending: true }),
      db.contacts.list(),
    ]);
    const allMsgs = msgs || [];
    const allContacts = crm || [];
    setMessages(allMsgs);
    setContacts(allContacts);
    const convs = groupByContact(allMsgs, allContacts);
    setConversations(convs);
  }, [instance]);

  useEffect(() => { loadInstance(); }, [loadInstance]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Abre a conversa automaticamente quando chega via ?phone= (Contatos/Pipeline)
  useEffect(() => {
    const phoneParam = searchParams.get('phone');
    if (!phoneParam || !instance) return;
    if (autoSelectedRef.current === phoneParam) return; // já tratou esse phone

    // 1) Tenta achar conversa existente
    const existing = conversations.find(c => samePhone(c.phone, phoneParam));
    if (existing) {
      autoSelectedRef.current = phoneParam;
      setSelected(existing);
      return;
    }

    // 2) Sem histórico ainda — cria conversa vazia a partir do contato do CRM
    const contact = contacts.find(c => c.phone && samePhone(c.phone, phoneParam));
    if (contact) {
      autoSelectedRef.current = phoneParam;
      const waNumber = toWhatsAppNumber(contact.phone);
      setSelected({
        jid: `${waNumber}@s.whatsapp.net`,
        phone: waNumber,
        name: contact.name,
        contact,
        messages: [],
        last: null,
      });
    }
  }, [searchParams, instance, conversations, contacts]);

  // Polling incremental — busca só mensagens novas (mais recentes que a última),
  // pausa quando a aba não está visível, e faz refresh imediato ao voltar o foco.
  useEffect(() => {
    if (!instance) return;
    const instName = instance.instance_name || instance.instanceName;

    async function pollNew() {
      if (document.hidden) return;
      const lastTs = messagesRef.current.length
        ? messagesRef.current[messagesRef.current.length - 1].timestamp
        : 0;
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('instance_name', instName)
        .gt('timestamp', lastTs)
        .order('timestamp', { ascending: true });
      if (data && data.length) {
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          const merged = [...prev, ...data.filter(m => !seen.has(m.id))];
          setConversations(groupByContact(merged, contactsRef.current));
          return merged;
        });
      }
    }

    const interval = setInterval(pollNew, 5000);
    const onVisible = () => { if (!document.hidden) pollNew(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [instance]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected, messages]);

  // Ao abrir uma conversa, busca o estado; o polling mantém em dia
  // (o dono pode ter respondido pelo celular).
  useEffect(() => {
    if (!selected?.phone) { setConvState(null); return; }
    loadConvState(selected.phone);
    const t = setInterval(() => { if (!document.hidden) loadConvState(selected.phone); }, 10000);
    return () => clearInterval(t);
  }, [selected?.phone, loadConvState]);

  async function syncMessages() {
    setSyncing(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    await fetch('/api/whatsapp/sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    await loadMessages();
    setSyncing(false);
  }

  async function send() {
    if (!text.trim() || !selected || !instance) return;
    setSending(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        to: toWhatsAppNumber(selected.phone),
        message: text.trim(),
        sender: 'human', // dono digitou → a conversa passa a ser humana automaticamente
      }),
    });
    setText('');
    setSending(false);
    await loadMessages();
    await loadConvState(selected.phone);
  }

  // ─── Estado da conversa (automação | humano) ───
  const loadConvState = useCallback(async (phone) => {
    if (!phone) return;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch(`/api/conversations/state?to=${encodeURIComponent(phone)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) setConvState(await res.json());
  }, []);

  async function resumeAutomation() {
    if (!selected) return;
    setResuming(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    await fetch('/api/conversations/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ to: selected.phone, state: 'automation' }),
    });
    await loadConvState(selected.phone);
    setResuming(false);
  }

  function mediaTypeOf(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    return 'document';
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo depois
    if (!file || !selected || !instance) return;

    // Limite de segurança (Evolution/WhatsApp): 16MB
    if (file.size > 16 * 1024 * 1024) {
      alert('Arquivo muito grande. Máximo 16MB.');
      return;
    }

    setUploading(true);
    try {
      const companyId = (instance.instance_name || instance.instanceName).replace('flowmate-', '');
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('whatsapp-media')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { alert('Erro ao subir arquivo: ' + upErr.message); setUploading(false); return; }

      const { data: pub } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
      const mediaUrl = pub.publicUrl;

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch('/api/whatsapp/send-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          to: toWhatsAppNumber(selected.phone),
          mediaUrl,
          mediaType: mediaTypeOf(file),
          mimeType: file.type,
          fileName: file.name,
          caption: text.trim() || undefined,
          sender: 'human', // anexo enviado pelo dono também assume a conversa
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert('Erro ao enviar mídia: ' + (d.error || 'tente novamente'));
      } else {
        setText('');
      }
      await loadMessages();
    } finally {
      setUploading(false);
    }
  }

  const currentMessages = selected
    ? messages.filter(m => m.remote_jid === selected.jid || samePhone(normalizePhone(m.remote_jid), selected.phone))
    : [];
  const filteredConversations = conversations.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  if (loadingInstance) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  if (!instance || instance.status !== 'connected') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 p-6">
        <WifiOff className="w-12 h-12 text-gray-300" />
        <p className="font-semibold text-gray-600 text-lg">WhatsApp não conectado</p>
        <p className="text-sm text-center text-gray-400">
          Vá em <span className="font-semibold text-blue-500">Configurações → WhatsApp</span> para conectar o número da empresa.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">

      {/* Lista de conversas */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-gray-100 bg-white`}>
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-800">Chats</h2>
            <div className="flex items-center gap-2">
              <button onClick={syncMessages} disabled={syncing} title="Importar conversas do WhatsApp"
                className="text-gray-400 hover:text-blue-500 disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-blue-400' : ''}`} />
              </button>
              <div className="flex items-center gap-1 text-xs text-green-500 font-medium">
                <Wifi className="w-3.5 h-3.5" />
                {instance.phone || 'Conectado'}
              </div>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm px-4">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">Nenhuma conversa ainda</p>
              <p className="text-xs mt-1 text-gray-300">Só aparecem contatos cadastrados no CRM</p>
              <button onClick={syncMessages} disabled={syncing} className="mt-3 flex items-center gap-1 text-xs text-blue-500 mx-auto disabled:opacity-40">
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Importando...' : 'Importar conversas'}
              </button>
            </div>
          ) : (
            filteredConversations.map(conv => (
              <button key={conv.jid} onClick={() => setSelected(conv)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 text-left
                  ${selected?.jid === conv.jid ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-green-600">{conv.name[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="font-semibold text-sm text-gray-800 truncate">{conv.name}</p>
                    <span className="text-xs text-gray-400 shrink-0 ml-1">{timeLabel(conv.last.timestamp)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {conv.last.from_me ? 'Você: ' : ''}{conv.last.content}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Área de mensagens */}
      {selected ? (
        <div className="flex-1 flex flex-col bg-gray-50">
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSelected(null)} className="md:hidden text-gray-400 hover:text-gray-600">←</button>
            <button
              onClick={() => selected.contact && setEditContact(selected.contact)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left group"
              title="Ver / editar dados do contato">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-green-600">{selected.name[0].toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate group-hover:text-green-600 transition-colors">{selected.name}</p>
                <p className="text-xs text-gray-400 truncate">{selected.phone}</p>
              </div>
            </button>
            {/* Estado da conversa: automação | humano */}
            {convState?.state === 'human' ? (
              <div className="shrink-0 flex items-center gap-2">
                <span title={convState.state_by ? 'Você assumiu esta conversa' : 'Assumida pelo celular'}
                  className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  👤 <span className="hidden sm:inline">você assumiu</span>
                </span>
                <button onClick={resumeAutomation} disabled={resuming}
                  title="Devolver esta conversa para a automação"
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
                  {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Devolver p/ automação</span>
                </button>
              </div>
            ) : (
              <span title="A automação está respondendo esta conversa"
                className="shrink-0 flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                🤖 <span className="hidden sm:inline">automação</span>
              </span>
            )}

            {selected.contact && (
              <button
                onClick={() => setEditContact(selected.contact)}
                title="Editar dados do lead"
                className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-200 rounded-lg px-2.5 py-1.5 transition-colors">
                <UserCog className="w-4 h-4" /> <span className="hidden sm:inline">Editar</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {currentMessages.map((msg, i) => {
              const hasCaption = msg.content && !['[imagem]', '[vídeo]', '[documento]', '[mídia]'].includes(msg.content);
              return (
              <div key={i} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm
                  ${msg.from_me ? 'bg-green-500 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'}`}>
                  {msg.media_url && msg.message_type === 'image' && (
                    <a href={msg.media_url} target="_blank" rel="noreferrer">
                      <img src={msg.media_url} alt="imagem" className="rounded-lg max-w-full mb-1 max-h-64 object-cover" />
                    </a>
                  )}
                  {msg.media_url && msg.message_type === 'video' && (
                    <video src={msg.media_url} controls className="rounded-lg max-w-full mb-1 max-h-64" />
                  )}
                  {msg.media_url && msg.message_type === 'document' && (
                    <a href={msg.media_url} target="_blank" rel="noreferrer"
                      className={`flex items-center gap-2 mb-1 rounded-lg px-2 py-1.5 ${msg.from_me ? 'bg-green-600/40' : 'bg-gray-100'}`}>
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="truncate underline">{msg.file_name || 'Documento'}</span>
                    </a>
                  )}
                  {hasCaption && <p>{msg.content}</p>}
                  <p className={`text-xs mt-1 ${msg.from_me ? 'text-green-100' : 'text-gray-400'}`}>{timeLabel(msg.timestamp)}</p>
                </div>
              </div>
            );})}
            <div ref={bottomRef} />
          </div>

          {canSend && (
            <div className="bg-white border-t border-gray-100 p-3 flex gap-2 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,application/pdf"
                onChange={handleFileSelected}
                className="hidden"
              />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                title="Anexar foto, vídeo ou PDF"
                className="text-gray-400 hover:text-green-500 disabled:opacity-40 shrink-0 p-2">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin text-green-500" /> : <Paperclip className="w-5 h-5" />}
              </button>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder={uploading ? 'Enviando anexo...' : 'Digite uma mensagem...'}
                disabled={uploading}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-60"
              />
              <button onClick={send} disabled={!text.trim() || sending || uploading}
                className="bg-green-500 hover:bg-green-600 text-white rounded-xl px-4 py-2 disabled:opacity-50 transition-colors shrink-0">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-gray-300 flex-col gap-3">
          <MessageCircle className="w-16 h-16 opacity-20" />
          <p className="text-gray-400">Selecione uma conversa</p>
        </div>
      )}

      {/* Painel lateral de edição do contato (aberto pelo header do chat) */}
      {editContact && (
        <ContactPanel
          contact={editContact}
          onClose={() => setEditContact(null)}
          onSave={async () => {
            setEditContact(null);
            await loadMessages(); // recarrega contatos → nome atualizado na conversa
          }}
        />
      )}
    </div>
  );
}
