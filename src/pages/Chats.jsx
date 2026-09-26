import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/store';
import { auth } from '../lib/auth';
import { Send, Search, MessageCircle, Wifi, WifiOff, Loader2, RefreshCw, Paperclip, FileText, X, UserCog, Bot, Users, UsersRound, Plus } from 'lucide-react';
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
  return String(jid || '').replace(/@.*/, '').replace(/\D/g, '');
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
        isGroup: false,
        messages: [],
        last: msg,
      };
    }
    map[key].messages.push(msg);
    if (msg.timestamp > map[key].last.timestamp) map[key].last = msg;
  }
  return Object.values(map).sort((a, b) => b.last.timestamp - a.last.timestamp);
}

// Agrupa mensagens por GRUPO (jid @g.us). Grupos sem mensagem também aparecem
// (com preview vazio), para você conseguir criá-los e encontrá-los aqui.
function groupByGroups(messages, groups) {
  return (groups || [])
    .map(g => {
      const msgs = messages.filter(m => m.remote_jid === g.jid);
      const last = msgs.length ? msgs.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
      return {
        jid: g.jid,
        phone: g.jid,
        name: g.name,
        contact: null,
        isGroup: true,
        group: g,
        messages: msgs,
        last,
      };
    })
    .sort((a, b) => {
      const ta = a.last?.timestamp || 0;
      const tb = b.last?.timestamp || 0;
      return tb - ta;
    });
}

// Lista unificada (Todas): conversas 1:1 + grupos, ordenada pela última mensagem.
function mergedConvs(conversations, groupConvs) {
  return [...conversations, ...groupConvs].sort((a, b) => {
    const ta = a.last?.timestamp || 0;
    const tb = b.last?.timestamp || 0;
    return tb - ta;
  });
}

function GroupAvatar({ name, isGroup, className = '' }) {
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isGroup ? 'bg-indigo-100' : 'bg-green-100'} ${className}`}>
      {isGroup
        ? <UsersRound className="w-5 h-5 text-indigo-500" />
        : <span className="text-sm font-bold text-green-600">{String(name || '?')[0].toUpperCase()}</span>}
    </div>
  );
}

export default function Chats() {
  const [searchParams] = useSearchParams();
  const autoSelectedRef = useRef(null);
  const autoSyncedRef = useRef(false);
  const [instance, setInstance] = useState(null);
  const [loadingInstance, setLoadingInstance] = useState(true);
  const [messages, setMessages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [groupConvs, setGroupConvs] = useState([]);
  const [filter, setFilter] = useState('all'); // all | chats | groups
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [convState, setConvState] = useState(null);   // { state, state_since, state_by }
  const [resuming, setResuming] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [groupError, setGroupError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesRef = useRef([]);
  const lastIdRef = useRef(0);
  const contactsRef = useRef([]);
  const groupsRef = useRef([]);
  const canSend = auth.can('chats', 'send');

  // Mantém refs sincronizados pro polling ler valores atuais sem recriar o intervalo
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

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
    const companyId = auth.currentCompanyId();
    const instName = instance?.instance_name || instance?.instanceName || (companyId ? `flowmate-${companyId}` : null);
    if (!instName) return;
    const [{ data: msgs }, crm, { data: grps }] = await Promise.all([
      supabase.from('whatsapp_messages').select('*').eq('instance_name', instName).order('timestamp', { ascending: true }),
      db.contacts.list(),
      supabase.from('whatsapp_groups').select('*').eq('instance_name', instName).order('updated_at', { ascending: false }),
    ]);
    const allMsgs = msgs || [];
    const allContacts = crm || [];
    const allGroups = grps || [];
    lastIdRef.current = allMsgs.reduce((m, x) => Math.max(m, x.id || 0), 0);
    setMessages(allMsgs);
    setContacts(allContacts);
    setGroups(allGroups);
    setConversations(groupByContact(allMsgs, allContacts));
    setGroupConvs(groupByGroups(allMsgs, allGroups));

    // Instância conectada e nenhuma mensagem no banco → importa o histórico
    // automaticamente uma vez (em vez de obrigar o usuário a achar o botão).
    if (instance.status === 'connected' && !allMsgs.length && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      syncMessages();
    }
  }, [instance]);

  // ─── Estado da conversa (automação | humano) — só vale em 1:1 ───
  const loadConvState = useCallback(async (phone) => {
    if (!phone) return;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch(`/api/conversations/state?to=${encodeURIComponent(phone)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) setConvState(await res.json());
  }, []);

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
        isGroup: false,
        messages: [],
        last: null,
      });
    }
  }, [searchParams, instance, conversations, contacts]);

  // Polling incremental — busca só mensagens novas (id maior que o último já
  // visto), pausa quando a aba não está visível, e faz refresh imediato ao
  // voltar o foco. Usa `id` (PK) em vez de `timestamp`: relógio do WhatsApp tem
  // resolução de 1s e msgs do mesmo segundo eram puladas para sempre.
  useEffect(() => {
    const companyId = auth.currentCompanyId();
    const instName = instance?.instance_name || instance?.instanceName || (companyId ? `flowmate-${companyId}` : null);
    if (!instName) return;

    async function pollNew() {
      if (document.hidden) return;
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('instance_name', instName)
        .gt('id', lastIdRef.current)
        .order('id', { ascending: true });
      if (data && data.length) {
        lastIdRef.current = data.reduce((m, x) => Math.max(m, x.id || 0), lastIdRef.current);
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          const merged = [...prev, ...data.filter(m => !seen.has(m.id))];
          setConversations(groupByContact(merged, contactsRef.current));
          setGroupConvs(groupByGroups(merged, groupsRef.current));
          return merged;
        });
      }
    }

    const interval = setInterval(pollNew, 3000);
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
  // (o dono pode ter respondido pelo celular). Grupos não têm estado.
  useEffect(() => {
    if (!selected?.phone || selected?.isGroup) { setConvState(null); return; }
    loadConvState(selected.phone);
    const t = setInterval(() => { if (!document.hidden) loadConvState(selected.phone); }, 10000);
    return () => clearInterval(t);
  }, [selected?.phone, selected?.isGroup, loadConvState]);

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
    // Grupo manda o JID cru (@g.us); 1:1 normaliza o telefone.
    const target = selected.isGroup ? selected.jid : toWhatsAppNumber(selected.phone);
    await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        to: target,
        message: text.trim(),
        sender: 'human', // dono digitou → a conversa passa a ser humana automaticamente
      }),
    });
    setText('');
    setSending(false);
    await loadMessages();
    if (!selected.isGroup) await loadConvState(selected.phone);
  }

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
      const target = selected.isGroup ? selected.jid : toWhatsAppNumber(selected.phone);
      const res = await fetch('/api/whatsapp/send-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          to: target,
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

  async function createGroup() {
    setGroupError('');
    if (!groupName.trim() || selectedIds.size === 0) {
      setGroupError('Preencha o nome do grupo e selecione ao menos 1 contato.');
      return;
    }
    setCreating(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch('/api/whatsapp/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDesc.trim() || undefined,
          participantIds: [...selectedIds],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGroupError(data.error || 'Erro ao criar grupo'); setCreating(false); return; }
      setShowCreateGroup(false);
      setGroupName(''); setGroupDesc(''); setGroupSearch(''); setSelectedIds(new Set()); setGroupError('');
      setFilter('groups');
      await loadMessages(); // recarrega contatos/grupos/mensagens
      if (data.group) {
        setSelected({
          jid: data.group.jid,
          phone: data.group.jid,
          name: data.group.name || groupName,
          contact: null,
          isGroup: true,
          group: data.group,
          messages: [],
          last: null,
        });
      }
    } finally {
      setCreating(false);
    }
  }

  const currentMessages = selected
    ? messages.filter(m => m.remote_jid === selected.jid || (!selected.isGroup && samePhone(normalizePhone(m.remote_jid), selected.phone)))
    : [];

  const baseList = filter === 'chats'
    ? conversations
    : filter === 'groups'
      ? groupConvs
      : mergedConvs(conversations, groupConvs);

  const filteredConversations = baseList.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    String(c.phone || '').includes(search)
  );

  const modalContacts = contacts.filter(c =>
    c.phone && (
      c.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
      c.phone.includes(groupSearch)
    )
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
              {canSend && (
                <button onClick={() => setShowCreateGroup(true)} title="Criar grupo"
                  className="text-gray-400 hover:text-blue-500 disabled:opacity-40 p-0.5">
                  <UsersRound className="w-4 h-4" />
                </button>
              )}
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

          {/* Filtro: Todas | Conversas | Grupos */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 mb-2">
            {[
              { k: 'all', label: 'Todas' },
              { k: 'chats', label: 'Conversas' },
              { k: 'groups', label: 'Grupos' },
            ].map(({ k, label }) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`flex-1 text-xs font-medium py-1 rounded-md transition-colors ${filter === k ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
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
              {filter === 'groups' ? (
                <>
                  <p className="font-medium">Nenhum grupo ainda</p>
                  <p className="text-xs mt-1 text-gray-300">Crie um grupo com os contatos do CRM</p>
                  {canSend && (
                    <button onClick={() => setShowCreateGroup(true)} className="mt-3 flex items-center gap-1 text-xs text-blue-500 mx-auto">
                      <Plus className="w-3 h-3" /> Criar grupo
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium">Nenhuma conversa ainda</p>
                  <p className="text-xs mt-1 text-gray-300">Só aparecem contatos cadastrados no CRM</p>
                  <button onClick={syncMessages} disabled={syncing} className="mt-3 flex items-center gap-1 text-xs text-blue-500 mx-auto disabled:opacity-40">
                    <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Importando...' : 'Importar conversas'}
                  </button>
                </>
              )}
            </div>
          ) : (
            filteredConversations.map(conv => (
              <button key={conv.jid} onClick={() => setSelected(conv)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 text-left
                  ${selected?.jid === conv.jid ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
                <GroupAvatar name={conv.name} isGroup={conv.isGroup} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="font-semibold text-sm text-gray-800 truncate">{conv.name}</p>
                    {conv.last && <span className="text-xs text-gray-400 shrink-0 ml-1">{timeLabel(conv.last.timestamp)}</span>}
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {conv.last
                      ? (conv.last.from_me
                          ? `Você: ${conv.last.content}`
                          : conv.isGroup && conv.last.contact_name
                            ? `${conv.last.contact_name}: ${conv.last.content}`
                            : conv.last.content)
                      : 'Sem mensagens ainda'}
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
              title={selected.contact ? 'Ver / editar dados do contato' : undefined}>
              <GroupAvatar name={selected.name} isGroup={selected.isGroup} className="w-9 h-9" />
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate group-hover:text-green-600 transition-colors">{selected.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {selected.isGroup
                    ? `${(selected.group?.participant_phones || []).length} participantes`
                    : selected.phone}
                </p>
              </div>
            </button>

            {/* Estado da conversa: só existe em 1:1. Grupo mostra badge próprio. */}
            {selected.isGroup ? (
              <span title="Grupo — a pausa de automação não se aplica"
                className="shrink-0 flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                <UsersRound className="w-3.5 h-3.5" /> <span className="hidden sm:inline">grupo</span>
              </span>
            ) : convState?.state === 'human' ? (
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
              const showSender = !msg.from_me && selected.isGroup && msg.contact_name;
              return (
              <div key={i} className={`flex flex-col ${msg.from_me ? 'items-end' : 'items-start'}`}>
                {showSender && (
                  <p className="text-[10px] font-semibold text-gray-400 mb-0.5 px-1">{msg.contact_name}</p>
                )}
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

      {/* Modal: criar grupo */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) { setSelectedIds(new Set()); setShowCreateGroup(false); } }}>
          <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-base">Novo grupo</h2>
                <p className="text-xs text-gray-400 mt-0.5">Cria o grupo no WhatsApp e adiciona os participantes</p>
              </div>
              <button onClick={() => { setSelectedIds(new Set()); setShowCreateGroup(false); }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Nome do grupo</label>
                <input
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="Ex: Pacientes — Convenio Unimed"
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Descrição (opcional)</label>
                <input
                  value={groupDesc}
                  onChange={e => setGroupDesc(e.target.value)}
                  placeholder="Ex: Avisos de horários e promoções"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Participantes ({selectedIds.size})
                  </label>
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                      Limpar
                    </button>
                  )}
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    placeholder="Buscar contato..."
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto space-y-0.5 border border-gray-100 rounded-xl">
                  {modalContacts.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">Nenhum contato com telefone cadastrado</p>
                  ) : (
                    modalContacts.map(c => {
                      const checked = selectedIds.has(c.id);
                      return (
                        <label key={c.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            })}
                            className="accent-blue-600"
                          />
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-green-600">{String(c.name || '?')[0].toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                            <p className="text-xs text-gray-400 truncate">{c.phone}</p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {groupError && <p className="text-sm text-red-500">{groupError}</p>}
            </div>

            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={createGroup}
                disabled={!groupName.trim() || selectedIds.size === 0 || creating}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UsersRound className="w-4 h-4" />}
                Criar grupo ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}