import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2, Inbox, Server } from 'lucide-react';

// Tela de saúde da linha (CF-A · A5). Só leitura. Os dados vêm de GET /api/whatsapp/health
// (admin + chave `health` da empresa). `data` = resposta da rota; `onRefresh` recarrega.

const ALERT_TEXT = {
  line_disconnected: 'Linha desconectada',
  write_failing: 'Mensagens recebidas com falha ao gravar',
  dead_events: 'Eventos que esgotaram as tentativas',
  evolution_down: 'Servidor do WhatsApp fora do ar',
  disk_high: 'Disco do servidor do WhatsApp acima de 70%',
};

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  if (mins < 1440) return `há ${Math.round(mins / 60)} h`;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Stat({ label, value, warn }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${warn ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${warn ? 'text-amber-700' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

export default function HealthPanel({ data, loading, onRefresh }) {
  if (!data) return null;
  const line = data.line;
  const connected = line?.status === 'connected';
  const inb = data.inbound || {};
  const rec = data.reconcile;
  const evo = data.evolution;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Saúde do WhatsApp</h2>
          <p className="text-xs text-gray-500">Conferido {when(data.checked_at)}</p>
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {data.alerts?.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          {data.alerts.map(a => (
            <div key={`${a.kind}-${a.subject}`} className="flex items-start gap-2 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">{ALERT_TEXT[a.kind] || a.kind}</div>
                <div className="text-xs text-red-600">{a.detail} · desde {when(a.opened_at)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 className="w-4 h-4" /> Nenhum alerta aberto
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded-xl border px-4 py-3 ${connected ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="text-xs text-gray-500">Linha {line?.phone || ''}</div>
          <div className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${connected ? 'text-green-700' : 'text-red-700'}`}>
            {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {line ? (connected ? 'Conectada' : 'Desconectada') : 'Sem linha'}
          </div>
        </div>
        <Stat label="Última mensagem recebida" value={when(data.last_inbound_at)} />
        <div className={`rounded-xl border px-4 py-3 ${evo && !evo.ok ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
          <div className="text-xs text-gray-500">Servidor do WhatsApp</div>
          <div className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${evo && !evo.ok ? 'text-red-700' : 'text-gray-800'}`}>
            <Server className="w-4 h-4" /> {evo ? (evo.ok ? `ok · ${evo.ms} ms` : 'fora do ar') : '—'}
          </div>
        </div>
        <Stat label="Recuperadas (total)" value={rec?.recovered_total ?? '—'} />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"><Inbox className="w-4 h-4" /> Caixa de entrada</div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Aguardando" value={inb.pending ?? 0} />
          <Stat label="Com falha (vão tentar de novo)" value={inb.failed ?? 0} warn={inb.failed > 0} />
          <Stat label="Esgotaram as tentativas" value={inb.dead ?? 0} warn={inb.dead > 0} />
        </div>
        {rec && (
          <p className="mt-3 text-xs text-gray-500">
            Conferência com o servidor: última {when(rec.last_run_at)}
            {rec.last_error ? ` · erro: ${rec.last_error}` : ` · última recuperação: ${rec.last_recovered ?? 0}`}
          </p>
        )}
      </div>
    </div>
  );
}
