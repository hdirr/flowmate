import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { auth } from '../lib/auth';
import { Send, Search, MessageCircle, Wifi, WifiOff, Loader2, RefreshCw } from 'lucide-react';

function timeLabel(ts) {
  const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function groupByContact(messages) {
  const map = {};
  for (const msg of messages) {
    const jid = msg.remote_jid;
    if (!map[jid]) map[jid] = { jid, name: msg.contact_name || jid.replace('@s.whatsapp.net', ''), messages: [], last: msg };
    map[jid].messages.push(msg);
    if (msg.timestamp > map[jid].last.timestamp) map[jid].last = msg;
  }
  return Object.values(map).sort((a, b) => b.last.timestamp - a.last.timestamp);
}

export default function Chats() {
  const [instance, setInstance] = useState(null);
  const [loadingInstance, setLoadingInstance] = useState(true);
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const bottomRef = useRef(null);
  const canSend = auth.can('chats', 'send');

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
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('instance_name', instName)
      .order('timestamp', { ascending: true });
    const msgs = data || [];
    setMessages(msgs);
    setConversations(groupByContact(msgs));
  }, [instance]);

  useEffect(() => { loadInstance(); }, [loadInstance]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Polling a cada 10s para novas mensagens
  useEffect(() => {
    if (!instance) return;
    const interval = setInterval(() => loadMessages(), 10000);
    return () => clearInterval(interval);
  }, [instance, loadMessages]);

  // Realtime — novas mensagens
  useEffect(() => {
    if (!instance) return;
    const channel = supabase
      .channel('whatsapp_messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `instance_name=eq.${instance.instance_name || instance.instanceName}`,
      }, payload => {
        setMessages(prev => {
          const updated = [...prev, payload.new];
          setConversations(groupByContact(updated));
          return updated;
        });
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [instance]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected, messages]);

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
      body: JSON.stringify({ to: selected.jid.replace('@s.whatsapp.net', ''), message: text.trim(), instanceName: instance.instance_name || instance.instanceName }),
    });
    setText('');
    setSending(false);
    await loadMessages();
  }

  const currentMessages = selected
    ? messages.filter(m => m.remote_jid === selected.jid)
    : [];

  const filteredConversations = conversations.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.jid.includes(search)
  );

  if (loadingInstance) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
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
              <button onClick={syncMessages} disabled={syncing} title="Importar conversas"
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
              placeholder="Buscar conversa..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Nenhuma conversa ainda</p>
              <button onClick={loadMessages} className="mt-3 flex items-center gap-1 text-xs text-blue-500 mx-auto">
                <RefreshCw className="w-3 h-3" /> Atualizar
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
          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSelected(null)} className="md:hidden text-gray-400 hover:text-gray-600">
              ←
            </button>
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-sm font-bold text-green-600">{selected.name[0].toUpperCase()}</span>
            </div>
            <div>
              <p className="font-semibold text-sm">{selected.name}</p>
              <p className="text-xs text-gray-400">{selected.jid.replace('@s.whatsapp.net', '')}</p>
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {currentMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm
                  ${msg.from_me
                    ? 'bg-green-500 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'}`}>
                  <p>{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.from_me ? 'text-green-100' : 'text-gray-400'}`}>
                    {timeLabel(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          {canSend && (
            <div className="bg-white border-t border-gray-100 p-3 flex gap-2">
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="Digite uma mensagem..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <button onClick={send} disabled={!text.trim() || sending}
                className="bg-green-500 hover:bg-green-600 text-white rounded-xl px-4 py-2 disabled:opacity-50 transition-colors">
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
    </div>
  );
}
