// Helpers das rotas novas da /v1 (Parte 1). As rotas antigas (v1handlers.js) não usam isto
// e continuam respondendo no formato de sempre.

// Erro que um handler novo pode lançar; o roteador (api/v1/[...path].js) converte em fail().
export class V1Error extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

// Erro padrão das rotas novas: { error: 'snake_case_code', message: 'texto em português' }
export function fail(res, status, error, message) {
  return res.status(status).json({ error, message });
}

// Lê um parâmetro de query sem diferenciar caixa (pageNumber, PageNumber, pagenumber).
// A Helena usa PascalCase em alguns exemplos; o n8n manda o que o usuário digitar.
export function queryParam(query, name) {
  if (!query) return undefined;
  if (query[name] !== undefined) return query[name];
  const want = name.toLowerCase();
  const key = Object.keys(query).find(k => k.toLowerCase() === want);
  const v = key === undefined ? undefined : query[key];
  return Array.isArray(v) ? v[0] : v;
}

function toInt(v) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Paginação no formato Helena. pageNumber >= 1 (padrão 1); pageSize 1..100 (padrão 20).
// Valor inválido ou menor que 1 cai no padrão; pageSize acima de 100 vira 100 (sem erro).
export function readPaging(query) {
  const pn = toInt(queryParam(query, 'pageNumber'));
  const ps = toInt(queryParam(query, 'pageSize'));
  const pageNumber = pn && pn >= 1 ? pn : 1;
  const pageSize = ps && ps >= 1 ? Math.min(ps, 100) : 20;
  const from = (pageNumber - 1) * pageSize;
  return { pageNumber, pageSize, from, to: from + pageSize - 1 };
}

// O PostgREST recusa .range() além do fim da lista (416, código PGRST103). Para a API isso
// não é erro: página além do fim responde items: [] (ver paged).
export function isRangeBeyondEnd(error) {
  return error?.code === 'PGRST103';
}

// Monta a resposta paginada a partir de { data, count } do Supabase
// (.select(..., { count: 'exact' }).range(from, to)).
export function paged(res, { pageNumber, pageSize }, items, totalItems) {
  const total = Number(totalItems) || 0;
  const totalPages = Math.ceil(total / pageSize);
  return res.status(200).json({
    pageNumber,
    pageSize,
    totalPages,
    totalItems: total,
    hasMorePages: pageNumber < totalPages,
    items: items || [],
  });
}

// Datas de filtro: createdAfter / createdBefore / updatedAfter / updatedBefore (ISO 8601).
// Ausente → null. Inválida → lança V1Error 400 invalid_date.
export function readDate(query, name) {
  const raw = queryParam(query, name);
  if (raw === undefined || raw === '') return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    throw new V1Error(400, 'invalid_date', `Data inválida em "${name}". Use ISO 8601, ex.: 2026-10-01T00:00:00Z.`);
  }
  return d.toISOString();
}

// Id que não é UUID vira 404 na rota, em vez de deixar o Postgres responder 500 de tipo.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// metadata (P1-E1): objeto JSON livre do contato/lead, só da API. Merge: chave com valor null
// é removida; as outras são sobrescritas; chaves não enviadas ficam. Limite: 50 chaves e 16 KB
// serializado (400 metadata_too_large). Fora de objeto → 400 invalid_field.
const METADATA_MAX_KEYS = 50;
const METADATA_MAX_BYTES = 16 * 1024;

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function mergeMetadata(current, incoming) {
  if (!isPlainObject(incoming)) {
    throw new V1Error(400, 'invalid_field', '"metadata": precisa ser um objeto JSON.');
  }
  const out = { ...(isPlainObject(current) ? current : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  if (Object.keys(out).length > METADATA_MAX_KEYS
      || Buffer.byteLength(JSON.stringify(out), 'utf8') > METADATA_MAX_BYTES) {
    throw new V1Error(400, 'metadata_too_large', `"metadata" aceita até ${METADATA_MAX_KEYS} chaves e 16 KB.`);
  }
  return out;
}

// Compara dois valores JSON sem depender da ordem das chaves (para saber se algo mudou).
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export function sameJson(a, b) {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}
