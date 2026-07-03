import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, MessageCircle, UserPlus, X, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/store';

const SEEN_KEY = 'flowmate:notif:lastSeen';

function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000;
  return new Date(ts).getTime();
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    o.start();
    o.stop(ctx.currentTime + 0.15);
  } catch { /* silêncio se o navegador bloquear */ }
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [lastSeen, setLastSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY)) || 0);
  const panelRef = useRef(null);
  const mountedRef = useRef(false);
  const pollMaxRef = useRef(0);

  const unread = items.filter(i => i.time > lastSeen).length;

  // Carga inicial: últimas mensagens recebidas + leads recentes
  const loadInitial = useCallback(async () => {
    const [{ data: msgs }, leads] = await Promise.all([
      supabase.from('whatsapp_messages')
        .select('*')
        .eq('from_me', false)
        .order('timestamp', { ascending: false })
        .limit(15),
      db.leads.list(),
    ]);

    const msgItems = (msgs || []).map(m => ({
      id: `msg-${m.id}`,
      type: 'message',
      title: m.contact_name || m.remote_jid?.replace(/@.*/, '') || 'Contato',
      subtitle: m.content,
      time: toMs(m.timestamp),
      phone: m.remote_jid?.replace(/@.*/, ''),
    }));

    const leadItems = (leads || []).slice(0, 15).map(l => ({
      id: `lead-${l.id}`,
      type: 'lead',
      title: l.contact?.name || 'Novo lead',
      subtitle: 'Novo lead no pipeline',
      time: toMs(l.created_at),
    }));

    const merged = [...msgItems, ...leadItems]
      .sort((a, b) => b.time - a.time)
      .slice(0, 30);
    setItems(merged);
  }, []);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Polling — recarrega notificações periodicamente (pausa com aba oculta).
  useEffect(() => {
    function poll() { if (!document.hidden) loadInitial(); }
    const interval = setInterval(poll, 15000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadInitial]);

  // Toca som quando chega item novo (compara com o máximo antes do último poll)
  useEffect(() => {
    if (!mountedRef.current) return;
    const maxNow = items.length ? Math.max(...items.map(i => i.time)) : 0;
    if (maxNow > pollMaxRef.current && pollMaxRef.current > 0) beep();
    pollMaxRef.current = Math.max(pollMaxRef.current, maxNow);
  }, [items]);

  // Evita beep na carga inicial
  useEffect(() => {
    const t = setTimeout(() => { mountedRef.current = true; }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function markAllRead() {
    const now = Date.now();
    setLastSeen(now);
    localStorage.setItem(SEEN_KEY, String(now));
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  }

  function openItem(item) {
    setOpen(false);
    if (item.type === 'message' && item.phone) {
      navigate(`/chats?phone=${item.phone.replace(/\D/g, '')}`);
    } else if (item.type === 'lead') {
      navigate('/pipeline');
    }
  }

  return (
    <div className="relative z-40" ref={panelRef}>
      <button onClick={toggle}
        className="relative w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors">
        <Bell className={`w-5 h-5 ${unread > 0 ? 'text-blue-600' : 'text-gray-500'}`} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-12 right-0 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-sm text-gray-800">Notificações</h3>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button onClick={markAllRead} title="Marcar todas como lidas"
                  className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Limpar
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              items.map(item => {
                const isUnread = item.time > lastSeen;
                const Icon = item.type === 'message' ? MessageCircle : UserPlus;
                const iconBg = item.type === 'message' ? 'bg-green-100 text-green-600' : 'bg-violet-100 text-violet-600';
                return (
                  <button key={item.id} onClick={() => openItem(item)}
                    className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 text-left
                      ${isUnread ? 'bg-blue-50/50' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm text-gray-800 truncate">{item.title}</p>
                        <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(item.time)}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{item.subtitle}</p>
                    </div>
                    {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
