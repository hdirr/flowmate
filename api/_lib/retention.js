// Retenção (peso dos dados): apaga, em lotes pequenos, as linhas que já cumpriram o papel.
// Roda no fim do processador (/api/whatsapp/jobs), com prazo próprio, para não atrasar o resto.
//
// Liga com DATA_RETENTION=on na Vercel (global, não por empresa). Desligada = como antes: só a
// limpeza antiga da caixa de entrada (concluídos com mais de 30 dias, cleanupInbound).
//
// Regras:
//   inbound_events     done/ignored com mais de 7 dias (received_at). Mortos e falhas ficam.
//   outbound_messages  sent com mais de 30 dias (created_at). pending/failed/dead ficam.
//                      Efeito: uma Idempotency-Key repetida depois de 30 dias envia de novo.
//   ops_alerts         resolvidos há mais de 90 dias (resolved_at). Abertos nunca saem.
//
// Cada lote: lê até BATCH ids (os mais antigos) e apaga por id, repetindo o filtro no delete.
// Apagar por chave primária, poucas linhas por vez, não segura a tabela.
export const RULES = [
  { table: 'inbound_events', col: 'received_at', days: 7, statuses: ['done', 'ignored'] },
  { table: 'outbound_messages', col: 'created_at', days: 30, statuses: ['sent'] },
  { table: 'ops_alerts', col: 'resolved_at', days: 90 },   // lt em resolved_at nulo = falso: abertos ficam
];
export const BATCH = 100;
const MAX_BATCHES = 5;            // por tabela e por execução (no máximo 500 linhas)
const INTERVAL_MS = 10 * 60_000;  // sem atraso pendente, no máximo uma vez a cada 10 min

export const retentionOn = () => process.env.DATA_RETENTION === 'on';

let lastRun = 0;
let behind = false;   // a última execução parou com linhas sobrando: a próxima não espera os 10 min

export async function runRetention(db, { now = Date.now(), deadline = Date.now() + 1_500, force = false } = {}) {
  if (!force && !behind && now - lastRun < INTERVAL_MS) return null;
  lastRun = now;
  behind = false;
  const out = {};
  for (const rule of RULES) {
    const r = { deleted: 0 };
    try {
      const cutoff = new Date(now - rule.days * 86_400_000).toISOString();
      for (let i = 0; i < MAX_BATCHES; i++) {
        if (Date.now() > deadline) { r.more = true; break; }
        const ids = await oldestIds(db, rule, cutoff);
        if (!ids.length) break;
        let del = db.from(rule.table).delete({ count: 'exact' }).in('id', ids).lt(rule.col, cutoff);
        if (rule.statuses) del = del.in('status', rule.statuses);
        const { error, count } = await del;
        if (error) throw new Error(error.message);
        r.deleted += count ?? ids.length;
        if (ids.length < BATCH) break;
        if (i === MAX_BATCHES - 1) r.more = true;
      }
    } catch (e) {
      r.error = String(e?.message || e).slice(0, 200);
      console.error(`[retention] ${rule.table}: ${r.error}`);
    }
    if (r.more) behind = true;
    out[rule.table] = r;
  }
  return out;
}

async function oldestIds(db, rule, cutoff) {
  let q = db.from(rule.table).select('id').lt(rule.col, cutoff);
  if (rule.statuses) q = q.in('status', rule.statuses);
  const { data, error } = await q.order(rule.col, { ascending: true }).limit(BATCH);
  if (error) throw new Error(error.message);
  return (data || []).map(x => x.id);
}

// Só para os testes locais.
export function _resetRetention() { lastRun = 0; behind = false; }
