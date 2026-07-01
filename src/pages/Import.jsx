import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, ArrowRight, Check, AlertCircle, Download, ShieldCheck } from 'lucide-react';
import { db } from '../lib/store';
import { auth } from '../lib/auth';

const STEPS = ['upload', 'mapear', 'resultado'];

export default function Import() {
  if (!auth.can('import', 'access')) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-gray-500 mt-16">
        <ShieldCheck className="w-10 h-10 text-gray-300" />
        <p className="font-medium">Sem permissão para acessar esta página.</p>
      </div>
    );
  }

  const [stages, setStages] = useState([]);
  const fileRef = useRef(null);

  const [step, setStep] = useState('upload');
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [map, setMap] = useState({ name: '', phone: '', email: '' });
  const [stageId, setStageId] = useState('');

  useEffect(() => { db.stages.list().then(s => { setStages(s); if (s[0]) setStageId(s[0].id); }); }, []);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  function handleFile(file) {
    setError('');
    setFileName(file.name);
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

  async function doImport() {
    if (!map.name) { setError('Selecione a coluna de nome.'); return; }
    let imported = 0, skipped = 0;

    for (const row of rows) {
      const name  = map.name  ? String(row[headers.indexOf(map.name)]  || '').trim() : '';
      const phone = map.phone ? String(row[headers.indexOf(map.phone)] || '').trim() : '';
      const email = map.email ? String(row[headers.indexOf(map.email)] || '').trim() : '';

      if (!name) { skipped++; continue; }

      const contact = await db.contacts.create({ name, phone, email });
      if (contact && stageId) await db.leads.create({ contact_id: contact.id, stage_id: stageId });
      imported++;
    }

    setResult({ imported, skipped });
    setStep('resultado');
  }

  function reset() {
    setStep('upload');
    setRows([]); setHeaders([]); setFileName('');
    setMap({ name: '', phone: '', email: '' });
    setResult(null); setError('');
    setStageId(stages[0]?.id ?? '');
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([['Nome', 'Telefone', 'Email'], ['João Silva', '(11) 99999-0000', 'joao@email.com']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
    XLSX.writeFile(wb, 'modelo_importacao.xlsx');
  }

  const colOptions = ['', ...headers];

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Importar contatos</h1>
        <p className="text-sm text-gray-400 mt-1">Importe uma planilha Excel ou CSV para adicionar contatos em massa</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-6">
        {['Arquivo', 'Mapeamento', 'Resultado'].map((label, i) => {
          const stepKeys = STEPS;
          const current = stepKeys.indexOf(step);
          const active = i === current;
          const done = i < current;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm ${active ? 'font-semibold text-gray-800' : done ? 'text-gray-500' : 'text-gray-300'}`}>{label}</span>
              {i < 2 && <ArrowRight className="w-4 h-4 text-gray-200 mx-1" />}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">

        {/* STEP 1 — Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
                <Upload className="w-7 h-7 text-blue-400" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-700">Clique ou arraste o arquivo aqui</p>
                <p className="text-sm text-gray-400 mt-1">Suporta .xlsx, .xls e .csv</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
              <div className="text-sm text-gray-500">
                <p className="font-semibold text-gray-600 mb-1">Formato esperado:</p>
                <p>Colunas: <span className="font-mono text-xs bg-gray-200 px-1 rounded">Nome</span> <span className="font-mono text-xs bg-gray-200 px-1 rounded">Telefone</span> <span className="font-mono text-xs bg-gray-200 px-1 rounded">Email</span></p>
              </div>
              <button onClick={downloadTemplate} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                <Download className="w-4 h-4" /> Baixar modelo
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — Mapear */}
        {step === 'mapear' && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-blue-50 px-3 py-2 rounded-lg">
              <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
              <span><b className="text-blue-700">{rows.length} linhas</b> encontradas em <b className="text-blue-700">{fileName}</b></span>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Mapeamento de colunas</h3>
              <div className="space-y-3">
                {[
                  { key: 'name',  label: 'Nome *'   },
                  { key: 'phone', label: 'Telefone'  },
                  { key: 'email', label: 'E-mail'    },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-24 shrink-0">{label}</span>
                    <select
                      value={map[key]}
                      onChange={e => setMap(m => ({ ...m, [key]: e.target.value }))}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    >
                      {colOptions.map(h => <option key={h} value={h}>{h || '— não importar —'}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Etapa no pipeline</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {stages.map(s => (
                  <button key={s.id} type="button"
                    onClick={() => setStageId(s.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors
                      ${stageId === s.id ? 'font-semibold' : 'border-gray-100 hover:bg-gray-50 text-gray-600'}`}
                    style={stageId === s.id ? { background: s.color + '18', color: s.color, borderColor: s.color + '55' } : {}}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="truncate">{s.name}</span>
                    {stageId === s.id && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Preview (3 primeiros)</h3>
              <div className="border border-gray-100 rounded-xl overflow-hidden text-sm divide-y divide-gray-50">
                {rows.slice(0, 3).map((row, i) => (
                  <div key={i} className="flex gap-4 px-3 py-2.5">
                    <span className="text-gray-700 font-medium w-36 truncate">
                      {map.name ? String(row[headers.indexOf(map.name)] || '—') : '—'}
                    </span>
                    <span className="text-gray-400 truncate">
                      {map.phone ? String(row[headers.indexOf(map.phone)] || '') : ''}
                    </span>
                    <span className="text-gray-400 truncate">
                      {map.email ? String(row[headers.indexOf(map.email)] || '') : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500 flex items-center gap-1 bg-red-50 px-3 py-2 rounded-lg"><AlertCircle className="w-4 h-4" />{error}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={reset} className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50">Voltar</button>
              <button onClick={doImport} disabled={!map.name}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                Importar {rows.length} contatos
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — Resultado */}
        {step === 'resultado' && result && (
          <div className="text-center py-8">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <Check className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="font-bold text-2xl mb-2">Importação concluída!</h3>
            <p className="text-gray-500 mb-1">
              <span className="text-green-600 font-semibold text-lg">{result.imported}</span> contatos importados com sucesso
            </p>
            {result.skipped > 0 && (
              <p className="text-gray-400 text-sm mb-6">{result.skipped} linha{result.skipped > 1 ? 's ignoradas' : ' ignorada'} (sem nome)</p>
            )}
            <div className="flex gap-2 justify-center mt-6">
              <button onClick={reset} className="border border-gray-200 px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Nova importação</button>
              <a href="/contatos" className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">Ver contatos</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
