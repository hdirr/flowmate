import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { db } from '../lib/store';

const STEPS = ['upload', 'mapear', 'importar'];

export default function ImportModal({ onClose, onDone }) {
  const stages = db.stages.list();
  const fileRef = useRef(null);

  const [step, setStep] = useState('upload');
  const [rows, setRows] = useState([]);       // todas as linhas do arquivo
  const [headers, setHeaders] = useState([]); // cabeçalhos detectados
  const [map, setMap] = useState({ name: '', phone: '', email: '' });
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [result, setResult] = useState(null); // { imported, skipped }
  const [error, setError] = useState('');

  function handleFile(file) {
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (data.length < 2) { setError('Arquivo vazio ou sem dados.'); return; }

        const hdrs = data[0].map(String);
        const dataRows = data.slice(1).filter(r => r.some(c => c !== ''));

        setHeaders(hdrs);
        setRows(dataRows);

        // Auto-detecta colunas por nome comum
        const find = (...terms) => hdrs.find(h =>
          terms.some(t => h.toLowerCase().includes(t))
        ) || '';

        setMap({
          name:  find('nome', 'name', 'cliente', 'contact'),
          phone: find('telefone', 'fone', 'phone', 'celular', 'whatsapp', 'tel'),
          email: find('email', 'e-mail', 'mail'),
        });

        setStep('mapear');
      } catch {
        setError('Não foi possível ler o arquivo. Use .xlsx, .xls ou .csv');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function doImport() {
    if (!map.name) { setError('Selecione a coluna de nome.'); return; }
    let imported = 0, skipped = 0;

    rows.forEach(row => {
      const name  = map.name  ? String(row[headers.indexOf(map.name)]  || '').trim() : '';
      const phone = map.phone ? String(row[headers.indexOf(map.phone)] || '').trim() : '';
      const email = map.email ? String(row[headers.indexOf(map.email)] || '').trim() : '';

      if (!name) { skipped++; return; }

      const contact = db.contacts.create({ name, phone, email });
      if (stageId) db.leads.create({ contact_id: contact.id, stage_id: stageId });
      imported++;
    });

    setResult({ imported, skipped });
    setStep('importar');
    onDone?.();
  }

  const colOptions = ['', ...headers];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-lg">Importar leads</h2>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-700" /></button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          {['Arquivo', 'Colunas', 'Resultado'].map((label, i) => {
            const current = STEPS.indexOf(step);
            const active = i === current;
            const done = i < current;
            return (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-sm ${active ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{label}</span>
                {i < 2 && <ArrowRight className="w-3.5 h-3.5 text-gray-300" />}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {/* STEP 1 — Upload */}
          {step === 'upload' && (
            <div>
              <div
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <Upload className="w-10 h-10 text-gray-300" />
                <div className="text-center">
                  <p className="font-semibold text-gray-600">Clique ou arraste o arquivo aqui</p>
                  <p className="text-sm text-gray-400 mt-1">Suporta .xlsx, .xls e .csv</p>
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />

              {error && (
                <div className="mt-3 flex items-center gap-2 text-red-500 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}

              <div className="mt-4 bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
                <p className="font-semibold text-gray-600 mb-1">Dica: sua planilha deve ter colunas como:</p>
                <p>• <b>Nome</b> — nome do contato (obrigatório)</p>
                <p>• <b>Telefone</b> — número com DDD</p>
                <p>• <b>Email</b> — endereço de e-mail</p>
              </div>
            </div>
          )}

          {/* STEP 2 — Mapear colunas */}
          {step === 'mapear' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">{rows.length} linhas encontradas. Confirme quais colunas correspondem a cada campo:</p>

              {[
                { key: 'name',  label: 'Nome *',    required: true  },
                { key: 'phone', label: 'Telefone',   required: false },
                { key: 'email', label: 'E-mail',     required: false },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">{label}</label>
                  <select
                    value={map[key]}
                    onChange={e => setMap(m => ({ ...m, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    {colOptions.map(h => <option key={h} value={h}>{h || '— não importar —'}</option>)}
                  </select>
                </div>
              ))}

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Adicionar ao pipeline</label>
                <div className="space-y-1.5">
                  {stages.map(s => (
                    <button key={s.id} type="button"
                      onClick={() => setStageId(s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                        ${stageId === s.id ? 'font-semibold' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                      style={stageId === s.id ? { background: s.color + '18', color: s.color, borderColor: s.color + '55' } : {}}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      {s.name}
                      {stageId === s.id && <span className="ml-auto">✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Preview (3 primeiros)</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden text-sm">
                  {rows.slice(0, 3).map((row, i) => (
                    <div key={i} className={`flex gap-4 px-3 py-2 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                      <span className="text-gray-700 font-medium w-28 truncate">
                        {map.name ? String(row[headers.indexOf(map.name)] || '—') : '—'}
                      </span>
                      <span className="text-gray-400 truncate">
                        {map.phone ? String(row[headers.indexOf(map.phone)] || '') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-500 flex items-center gap-1"><AlertCircle className="w-4 h-4" />{error}</p>}
            </div>
          )}

          {/* STEP 3 — Resultado */}
          {step === 'importar' && result && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="font-bold text-xl mb-1">Importação concluída!</h3>
              <p className="text-gray-500 text-sm mb-6">
                <span className="text-green-600 font-semibold">{result.imported} contatos</span> importados
                {result.skipped > 0 && <>, <span className="text-gray-400">{result.skipped} ignorados</span> (sem nome)</>}
              </p>
              <button onClick={onClose} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
                Ver contatos
              </button>
            </div>
          )}
        </div>

        {/* Footer com ações */}
        {step === 'mapear' && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button onClick={() => setStep('upload')} className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Voltar</button>
            <button onClick={doImport} disabled={!map.name} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              Importar {rows.length} contatos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
