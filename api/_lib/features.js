import { adminClient } from './db.js';

// Chaves liga/desliga por empresa (companies.features, jsonb) — PLANO-CONFIABILIDADE.md.
// Leitura DEFENSIVA: coluna ausente (SQL da CF-A ainda não rodado), erro ou empresa sem a
// chave → desligada, ou seja, o comportamento de hoje. Cache curto por instância da função
// (desligar no banco vale em até CACHE_MS, sem deploy).
const CACHE_MS = 30_000;
const cache = new Map(); // companyId → { at, features }

export async function getFeatures(companyId, admin = adminClient()) {
  if (!companyId) return {};
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.features;
  let features = {};
  try {
    const { data, error } = await admin.from('companies').select('features').eq('id', companyId).maybeSingle();
    if (!error && data?.features && typeof data.features === 'object' && !Array.isArray(data.features)) {
      features = data.features;
    }
  } catch { /* defensiva: desligado */ }
  cache.set(companyId, { at: Date.now(), features });
  return features;
}

export async function isFeatureOn(companyId, key, admin) {
  const f = await getFeatures(companyId, admin);
  return f[key] === true;
}

// Só para testes.
export function _clearFeatureCache() { cache.clear(); }
