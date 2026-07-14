import { useState, useEffect } from 'react';
import { permissionsStore, ROLE_LABELS, DEFAULT_PERMISSIONS, auth } from '../lib/auth';
import { RotateCcw, ShieldCheck, Smartphone, Wifi, WifiOff, Loader2, RefreshCw, Webhook, Copy, Check, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/store';
import QRCode from 'react-qrcode-logo';

const OUTBOUND_EVENTS = [
  { value: 'message.received', label: 'Mensagem recebida',    hint: 'só quando a conversa está em automação' },
  { value: 'message.sent',     label: 'Mensagem enviada',     hint: 'inclui o campo sender (human | automation)' },
  { value: 'contact.created',  label: 'Contato criado' },
  { value: 'lead.created',     label: 'Lead criado' },
  { value: 'lead.moved',       label: 'Lead mudou de etapa' },
];

// Normaliza URLs coladas do painel (ex: webhook.site dá a URL de VISUALIZAÇÃO,
// que não recebe POST). Converte pra URL que de fato aceita a requisição.
function normalizeWebhookUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  // https://webhook.site/#!/view/<uuid>[/...]  →  https://webhook.site/<uuid>
  const m = url.match(/^(https?:\/\/[^/]+)\/#!\/view\/([0-9a-fA-F-]{36})/);
  if (m) return `${m[1]}/${m[2]}`;
  // Qualquer outra coisa com fragmento (#) não é endpoint — corta o fragmento
  return url.split('#')[0];
}

const MODULES = {
  pipeline:    { label: 'Pipeline',    actions: { view_all: 'Ver todos', view_own: 'Ver próprios', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  contacts:    { label: 'Contatos',    actions: { view_all: 'Ver todos', view_own: 'Ver próprios', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  chats:       { label: 'Chats',       actions: { view_all: 'Ver todos', view_own: 'Ver próprios', send: 'Enviar mensagem' } },
  automations: { label: 'Automações',  actions: { view: 'Ver', create: 'Criar', edit: 'Editar', remove: 'Remover', execute: 'Executar' } },
  import:      { label: 'Importar',    actions: { access: 'Acessar' } },
  users:       { label: 'Usuários',    actions: { view: 'Ver', create: 'Criar', edit: 'Editar', remove: 'Remover' } },
  settings:    { label: 'Configurações', actions: { access: 'Acessar' } },
};

const ROLES = ['admin', 'manager', 'seller'];

export default function Settings() {
  const isAdmin = auth.isAdmin();
  const [perms, setPerms] = useState(() => permissionsStore.get());
  const [activeRole, setActiveRole] = useState('manager');
  const [saved, setSaved] = useState(false);

  // WhatsApp
  const [waInstance, setWaInstance] = useState(null);
  const [waQr, setWaQr] = useState(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState(null);
  const [waTab, setWaTab] = useState('permissions');

  // Integrações
  const [integ, setInteg] = useState(null);
  const [integUrl, setIntegUrl] = useState('');
  const [integEvents, setIntegEvents] = useState([]);
  const [integSaved, setIntegSaved] = useState(false);
  const [copied, setCopied] = useState('');
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  async function loadIntegrations() {
    const data = await db.integrations.get();
    setInteg(data);
    setIntegUrl(data?.webhook_url || '');
    setIntegEvents(data?.webhook_events || []);
  }
  useEffect(() => { if (isAdmin) loadIntegrations(); }, [isAdmin]);

  async function saveIntegrations() {
    const url = normalizeWebhookUrl(integUrl);
    setIntegUrl(url); // mostra a URL corrigida de volta pro usuário
    await db.integrations.save({ webhook_url: url, webhook_events: integEvents, enabled: true });
    await loadIntegrations();
    setIntegSaved(true);
    setTimeout(() => setIntegSaved(false), 1800);
  }
  async function regenKey() {
    if (!confirm('Gerar uma nova chave? A chave atual deixará de funcionar imediatamente.')) return;
    await db.integrations.regenerateKey();
    await loadIntegrations();
  }
  function toggleIntegEvent(ev) {
    setIntegEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  }
  function copy(text, tag) {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(''), 1500);
  }

  async function fetchWaStatus() {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/whatsapp/status', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setWaInstance(data.status === 'connected' ? data : null);
    }
  }

  useEffect(() => { fetchWaStatus(); }, []);

  async function connectWhatsApp() {
    setWaLoading(true);
    setWaQr(null);
    setWaError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.connected) {
        await fetchWaStatus();
      } else if (data.qr) {
        setWaQr(data.qr);
      } else {
        setWaError(data.error || `Sem QR code na resposta: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      setWaError(e.message);
    }
    setWaLoading(false);
  }

  async function refreshWaStatus() {
    await fetchWaStatus();
    setWaQr(null);
  }

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-gray-500 mt-16">
        <ShieldCheck className="w-10 h-10 text-gray-300" />
        <p className="font-medium">Sem permissão para acessar esta página.</p>
      </div>
    );
  }

  async function toggle(module, action) {
    const current = perms[activeRole]?.[module]?.[action] ?? false;
    const updated = {
      ...perms,
      [activeRole]: {
        ...perms[activeRole],
        [module]: { ...perms[activeRole]?.[module], [action]: !current },
      },
    };
    setPerms(updated);
    await permissionsStore.set(activeRole, module, action, !current);
    showSaved();
  }

  async function reset() {
    if (!confirm(`Resetar permissões do ${ROLE_LABELS[activeRole].label} para o padrão?`)) return;
    await permissionsStore.reset(activeRole);
    setPerms(permissionsStore.get());
    showSaved();
  }

  function showSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const roleInfo = ROLE_LABELS[activeRole];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure permissões e integrações</p>
      </div>

      {/* Tabs principais */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setWaTab('permissions')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border
            ${waTab === 'permissions' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
          Permissões
        </button>
        <button onClick={() => setWaTab('whatsapp')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border flex items-center gap-2
            ${waTab === 'whatsapp' ? 'bg-green-500 text-white border-green-500' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
          <Smartphone className="w-4 h-4" /> WhatsApp
          {waInstance?.status === 'connected' && <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />}
        </button>
        <button onClick={() => setWaTab('integrations')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border flex items-center gap-2
            ${waTab === 'integrations' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
          <Webhook className="w-4 h-4" /> Integrações
        </button>
      </div>

      {/* Tab Integrações */}
      {waTab === 'integrations' && (
        <div className="space-y-6">
          {/* Webhook de saída */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Webhook className="w-4 h-4 text-indigo-500" /> Webhook de saída</h3>
            <p className="text-sm text-gray-400 mt-0.5 mb-4">Envie eventos do CRM para o n8n, Zapier, Make ou qualquer URL. Disparamos um POST quando o evento acontece.</p>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">URL de destino</label>
            <input value={integUrl} onChange={e => setIntegUrl(e.target.value)}
              placeholder="https://seu-n8n.com/webhook/flowmate"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            {integUrl && normalizeWebhookUrl(integUrl) !== integUrl.trim() && (
              <p className="text-xs text-amber-600 mt-1 mb-3">
                ⚠️ Essa é uma URL de visualização (não recebe POST). Ao salvar, vamos corrigir para:{' '}
                <code className="bg-amber-50 px-1 rounded">{normalizeWebhookUrl(integUrl)}</code>
              </p>
            )}
            <div className="mb-4" />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Eventos a enviar</label>
            <p className="text-xs text-gray-400 mb-2">Se <b>nenhum</b> for marcado, enviamos <b>todos</b>. Marcar um filtra os demais.</p>
            <div className="space-y-1.5 mb-4">
              {OUTBOUND_EVENTS.map(ev => {
                const on = integEvents.includes(ev.value);
                return (
                  <button key={ev.value} type="button" onClick={() => toggleIntegEvent(ev.value)}
                    className={`w-full flex items-start gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                      ${on ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <span className={`w-4 h-4 mt-0.5 rounded flex items-center justify-center shrink-0 ${on ? 'bg-indigo-500' : 'border border-gray-300'}`}>
                      {on && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block">{ev.label}</span>
                      {ev.hint && <span className="block text-xs text-gray-400 mt-0.5">{ev.hint}</span>}
                    </span>
                    <code className="text-xs text-gray-400 shrink-0">{ev.value}</code>
                  </button>
                );
              })}
            </div>
            <button onClick={saveIntegrations}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${integSaved ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
              {integSaved ? 'Salvo ✓' : 'Salvar webhook'}
            </button>
          </div>

          {/* API de entrada */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><KeyRound className="w-4 h-4 text-indigo-500" /> API de entrada</h3>
            <p className="text-sm text-gray-400 mt-0.5 mb-4">Deixe plataformas externas criarem contatos/leads no FlowMate. Use a chave abaixo no header <code className="bg-gray-100 px-1 rounded">x-api-key</code>.</p>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Endpoint</label>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 truncate">POST {appOrigin}/api/public/lead</code>
              <button onClick={() => copy(`${appOrigin}/api/public/lead`, 'url')} className="text-gray-400 hover:text-indigo-600 p-2">
                {copied === 'url' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Sua chave (x-api-key)</label>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 truncate">{integ?.api_key || '— rode o SQL para gerar —'}</code>
              {integ?.api_key && (
                <button onClick={() => copy(integ.api_key, 'key')} className="text-gray-400 hover:text-indigo-600 p-2">
                  {copied === 'key' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
              <button onClick={regenKey} title="Gerar nova chave" className="text-gray-400 hover:text-red-500 p-2"><RotateCcw className="w-4 h-4" /></button>
            </div>

            <div className="bg-gray-900 rounded-xl p-3 overflow-x-auto">
              <pre className="text-xs text-gray-300 whitespace-pre">{`curl -X POST ${appOrigin}/api/public/lead \\
  -H "x-api-key: ${integ?.api_key || 'SUA_CHAVE'}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"João","phone":"31999998888","pipeline_name":"Funil principal"}'`}</pre>
            </div>
            <p className="text-xs text-gray-400 mt-2">Campos: <b>name</b> (obrigatório), phone, email, stage_id ou pipeline_name (opcionais).</p>
          </div>
        </div>
      )}

      {/* Tab WhatsApp */}
      {waTab === 'whatsapp' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-gray-800">Conexão WhatsApp</h3>
              <p className="text-sm text-gray-400 mt-0.5">Conecte o número da empresa para enviar e receber mensagens</p>
            </div>
            <button onClick={refreshWaStatus} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {waInstance?.status === 'connected' ? (
            <div className="flex items-center gap-4 bg-green-50 border border-green-100 rounded-xl p-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Wifi className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="font-semibold text-green-700">WhatsApp conectado!</p>
                <p className="text-sm text-green-600">{waInstance.phone || 'Número ativo'}</p>
              </div>
              <button onClick={connectWhatsApp} className="ml-auto text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">
                Reconectar
              </button>
            </div>
          ) : (
            <div className="text-center">
              {!waQr ? (
                <div className="py-8">
                  <WifiOff className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 mb-4">Nenhum WhatsApp conectado</p>
                  {waError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 mb-4 text-left break-all">
                      {waError}
                    </div>
                  )}
                  <button onClick={connectWhatsApp} disabled={waLoading}
                    className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2 mx-auto">
                    {waLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                    {waLoading ? 'Gerando QR code...' : 'Conectar WhatsApp'}
                  </button>
                </div>
              ) : (
                <div className="py-4">
                  <p className="text-sm text-gray-500 mb-4">Abra o WhatsApp no celular → Dispositivos conectados → Conectar dispositivo → Escaneie o QR code</p>
                  <div className="flex justify-center mb-4">
                    {waQr.startsWith('data:') ? (
                      <img src={waQr} alt="QR Code WhatsApp" className="w-56 h-56 rounded-xl border border-gray-100" />
                    ) : (
                      <QRCode value={waQr} size={220} logoImage="/logo.png" logoWidth={40} />
                    )}
                  </div>
                  <button onClick={refreshWaStatus} className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600 mx-auto">
                    <RefreshCw className="w-3.5 h-3.5" /> Já escaneei — verificar conexão
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab Permissões */}
      {waTab === 'permissions' && <>
      {/* Role tabs */}
      <div className="flex gap-2 mb-6">
        {ROLES.map(r => {
          const rl = ROLE_LABELS[r];
          const active = r === activeRole;
          return (
            <button key={r} onClick={() => setActiveRole(r)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border
                ${active ? 'text-white border-transparent shadow' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              style={active ? { backgroundColor: rl.color, borderColor: rl.color } : {}}>
              {rl.label}
            </button>
          );
        })}
      </div>

      {/* Aviso admin */}
      {activeRole === 'admin' && (
        <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          Admins sempre têm acesso total ao sistema. Permissões não se aplicam a este papel.
        </div>
      )}

      {/* Tabela de permissões */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {Object.entries(MODULES).map(([modKey, mod], idx) => (
          <div key={modKey} className={`${idx > 0 ? 'border-t border-gray-100' : ''}`}>
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{mod.label}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {Object.entries(mod.actions).map(([actKey, actLabel]) => {
                const enabled = perms[activeRole]?.[modKey]?.[actKey] ?? false;
                const isAdminRole = activeRole === 'admin';
                return (
                  <div key={actKey} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-gray-600">{actLabel}</span>
                    <button
                      onClick={() => !isAdminRole && toggle(modKey, actKey)}
                      disabled={isAdminRole}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                        enabled || isAdminRole ? 'bg-blue-500' : 'bg-gray-200'
                      } ${isAdminRole ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                        ${enabled || isAdminRole ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4">
        <button onClick={reset} disabled={activeRole === 'admin'}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-default">
          <RotateCcw className="w-4 h-4" /> Restaurar padrão
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium animate-pulse">Salvo automaticamente ✓</span>
        )}
      </div>
      </>}
    </div>
  );
}
