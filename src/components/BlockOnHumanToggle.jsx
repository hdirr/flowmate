import { useState, useEffect } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { labelsApi } from '../lib/labels';

// ET-3: trava opcional por empresa (companies.features.block_api_send_on_human). Ligada = o envio
// automático (API/automação) é recusado (409) em conversa com "Atendimento humano", inclusive
// na gêmea. Desligada (padrão) = a etiqueta é só marcador e quem decide é o fluxo do n8n.
// O envio pela tela (atendente) nunca é bloqueado. Só o admin altera (o servidor confere).
export default function BlockOnHumanToggle() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    labelsApi.settings().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;
  const on = data.block_api_send_on_human;

  async function toggle() {
    if (on && !confirm('Desligar a trava?\n\nA automação (n8n) poderá responder mesmo com um atendente na conversa. O seu fluxo precisa conferir a etiqueta "Atendimento humano" antes de responder.')) return;
    setBusy(true);
    setError('');
    try { setData(await labelsApi.setBlockOnHuman(!on)); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      <ShieldAlert className={`w-5 h-5 shrink-0 mt-0.5 ${on ? 'text-amber-500' : 'text-gray-300'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">Bloquear envio da automação em conversas com Atendimento humano</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {on
            ? 'Ligada: enquanto a conversa estiver com "Atendimento humano", o envio pela API/automação é recusado (vale também para o mesmo celular com ou sem o 9º dígito).'
            : 'Desligada: a etiqueta só marca a conversa e a automação pode enviar. Risco: se o seu fluxo do n8n não conferir "Atendimento humano" antes de responder, ele pode responder por cima do atendente.'}
          {' '}O envio pela tela (atendente) nunca é bloqueado.
        </p>
        {!data.can_change && <p className="text-[11px] text-gray-400 mt-1">Só o admin altera.</p>}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <button type="button" role="switch" aria-checked={on} onClick={toggle} disabled={!data.can_change || busy}
        title={data.can_change ? (on ? 'Desligar a trava' : 'Ligar a trava') : 'Só o admin altera'}
        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-amber-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform flex items-center justify-center ${on ? 'translate-x-4' : ''}`}>
          {busy && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </span>
      </button>
    </div>
  );
}
