import { getOrCreateConversation } from './conversations.js';
import { parseMessage } from './whatsappParse.js';

// CF-A · A4 — Reconciliação por linha (chave `reconcile` por empresa).
// A cada execução do processador (/api/whatsapp/jobs), para cada empresa com a chave ligada e
// instância conectada: pede à Evolution as mensagens de uma JANELA de tempo e grava as que
// faltam no Supabase. Avança o marcador (line_sync_state.reconciled_until) só quando a janela
// inteira foi conferida — nunca pula buraco.
//
// Regras:
// - Janela: do marcador menos 10 min de sobreposição até no máximo 30 min depois, e nunca
//   além de "agora − 2 min" (o webhook normal tem a vez). Primeira vez: últimas 24 h, em
//   janelas de 30 min. Nunca antes de 7 dias (a Evolution é o arquivo; o Supabase guarda 7 dias).
// - Só GRAVA. Não muda estado de conversa nem dispara message.received para o n8n (uma
//   mensagem recuperada horas depois não deve gerar resposta automática atrasada). Conta as
//   recuperadas para a saúde (A5).
// - Gravação idempotente: upsert em (company_id, message_id) — exige a chave única da PARTE 3.
//
// A confirmar na Evolution 2.3.7: o filtro messageTimestamp aceita data ISO em gte/lte
// (o código converte data → segundos) e a página é `offset` (não `limit`).

export const WINDOW_S = 30 * 60;
export const OVERLAP_S = 10 * 60;
export const SAFETY_S = 2 * 60;
export const FIRST_LOOKBACK_S = 24 * 3600;
export const MAX_LOOKBACK_S = 7 * 86400;
export const PAGE_SIZE = 100;

// Próxima janela [from, to] em segundos, ou null se não há o que conferir.
export function nextWindow(reconciledUntil, nowS) {
  const ceil = nowS - SAFETY_S;
  let from = reconciledUntil ? reconciledUntil - OVERLAP_S : nowS - FIRST_LOOKBACK_S;
  from = Math.max(from, nowS - MAX_LOOKBACK_S);
  if (from >= ceil) return null;
  return { from, to: Math.min(from + WINDOW_S, ceil) };
}

// Linha de whatsapp_messages a partir de um registro do findMessages (mesmos campos do sync).
export function rowFromRecord({ companyId, instanceName, rec }) {
  const key = rec?.key || {};
  const remoteJid = key.remoteJidAlt || key.remoteJid || '';
  const messageId = key.id || rec?.id || null;
  if (!remoteJid || !messageId) return null;
  if (remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) return null;
  const parsed = parseMessage(rec.message);
  const content = parsed.content;
  if (!content) return null;
  const isGroup = remoteJid.includes('@g.us');
  const participantJid = isGroup ? (key.participant || null) : null;
  const fromMe = !!key.fromMe;
  return {
    company_id: companyId,
    instance_name: instanceName,
    remote_jid: remoteJid,
    participant_jid: participantJid,
    from_me: fromMe,
    message_type: parsed.type,
    content,
    file_name: parsed.fileName,
    timestamp: Number(rec.messageTimestamp) || null,
    contact_name: isGroup
      ? (rec.pushName || (participantJid ? participantJid.replace(/@.*/, '') : remoteJid.replace(/@.*/, '')))
      : (rec.pushName || remoteJid.replace(/@.*/, '')),
    status: fromMe ? 'sent' : 'received',
    message_id: messageId,
  };
}

// Confere UMA janela de UMA instância. evo(path, {method, body}) → { ok, json }.
// Devolve { complete, recovered, pages } ou lança.
export async function reconcileWindow(db, evo, { companyId, instanceName, from, to, deadline }) {
  let page = 1, pages = 1, recovered = 0, occupied = 0;
  const convCache = new Map();
  while (page <= pages) {
    if (Date.now() > deadline) return { complete: false, recovered, occupied, pages };
    const r = await evo(`/chat/findMessages/${instanceName}`, {
      method: 'POST',
      body: {
        where: { messageTimestamp: { gte: new Date(from * 1000).toISOString(), lte: new Date(to * 1000).toISOString() } },
        offset: PAGE_SIZE,
        page,
      },
    });
    if (!r.ok) throw new Error(`findMessages ${r.status}`);
    const env = r.json?.messages || r.json || {};
    const records = (Array.isArray(env) ? env : env.records) || [];
    pages = Number(env.pages) || 1;

    const rows = records.map(rec => rowFromRecord({ companyId, instanceName, rec })).filter(Boolean)
      // defesa: só a janela pedida (se a Evolution ignorar o filtro, não grava fora dela)
      .filter(row => row.timestamp && row.timestamp >= from && row.timestamp <= to);
    if (rows.length) {
      // Quais já existem (uma consulta por página)
      const ids = rows.map(x => x.message_id);
      const { data: have, error: hErr } = await db.from('whatsapp_messages').select('message_id')
        .eq('company_id', companyId).in('message_id', ids);
      if (hErr) throw new Error(`leitura falhou: ${hErr.message}`);
      const exists = new Set((have || []).map(h => h.message_id));
      const missing = rows.filter(x => !exists.has(x.message_id));
      for (const row of missing) {
        if (!convCache.has(row.remote_jid)) {
          const conv = await getOrCreateConversation(companyId, row.remote_jid, db);
          convCache.set(row.remote_jid, conv?.id ?? null);
        }
        row.conversation_id = convCache.get(row.remote_jid);
      }
      if (missing.length) {
        const { data: ins, error: iErr } = await db.from('whatsapp_messages')
          .upsert(missing, { onConflict: 'company_id,message_id', ignoreDuplicates: true })
          .select('id');
        if (!iErr) recovered += (ins || []).length;
        else if (iErr.code === '23505') {
          // Uma chave única GLOBAL em message_id (de hoje, até a contração da A2) barrou o
          // lote: a mensagem é de outra empresa (ex.: mesmo grupo). Grava uma a uma e conta
          // as ocupadas, sem travar a janela.
          for (const row of missing) {
            const { error: e1 } = await db.from('whatsapp_messages').insert(row);
            if (!e1) recovered++;
            else if (e1.code === '23505') occupied++;
            else throw new Error(`gravação falhou: ${e1.message}`);
          }
        } else throw new Error(`gravação falhou: ${iErr.message}`);
      }
    }
    // Freio: a lista vem da mais nova para a mais antiga. Se esta página já passou do início
    // da janela (Evolution ignorando o filtro de data), o resto é mais antigo: para aqui.
    // Uma mensagem anterior ao início da janela já prova que o filtro foi ignorado. Só freia se
    // a página estiver mesmo em ordem decrescente (aí o resto é mais antigo); em ordem
    // crescente ou misturada, segue paginando (mais caro, mas não pula buraco).
    const tss = records.map(rec => Number(rec?.messageTimestamp)).filter(Number.isFinite);
    const desc = tss.every((x, i) => i === 0 || tss[i - 1] >= x);
    if (tss.length && desc && Math.min(...tss) < from) break;
    page++;
  }
  return { complete: true, recovered, occupied, pages };
}

// Uma rodada para todas as linhas com a chave ligada. Grava o resultado em line_sync_state.
export async function runReconcile(db, evo, { deadline = Date.now() + 8_000, nowS = Math.floor(Date.now() / 1000) } = {}) {
  const { data: comps, error } = await db.from('companies').select('id').eq('features->>reconcile', 'true');
  if (error) return { error: error.message };
  const out = [];
  for (const c of comps || []) {
    const { data: inst } = await db.from('whatsapp_instances').select('instance_name, status')
      .eq('company_id', c.id).maybeSingle();
    if (!inst || inst.status !== 'connected') { out.push({ company: c.id, skipped: 'desconectada' }); continue; }
    const { data: st, error: stErr } = await db.from('line_sync_state').select('*')
      .eq('company_id', c.id).eq('instance_name', inst.instance_name).maybeSingle();
    // Sem o marcador não dá para saber de onde seguir: pula a linha nesta rodada.
    if (stErr) { out.push({ company: c.id, error: `marcador ilegível: ${stErr.message}` }); continue; }
    let until = st?.reconciled_until ?? null;
    let recovered = 0, occupied = 0, windows = 0, lastError = null;
    while (Date.now() < deadline) {
      const w = nextWindow(until, nowS);
      if (!w) break;
      try {
        const r = await reconcileWindow(db, evo, { companyId: c.id, instanceName: inst.instance_name, ...w, deadline });
        recovered += r.recovered; occupied += r.occupied || 0;
        if (!r.complete) break;
        until = w.to; windows++;
      } catch (e) { lastError = String(e?.message || e).slice(0, 300); break; }
    }
    const nowIso = new Date().toISOString();
    const { error: upErr } = await db.from('line_sync_state').upsert({
      company_id: c.id, instance_name: inst.instance_name,
      reconciled_until: until, last_run_at: nowIso,
      ...(lastError ? { last_error: lastError } : { last_ok_at: nowIso, last_error: null }),
      last_recovered: recovered,
      recovered_total: (st?.recovered_total || 0) + recovered,
    }, { onConflict: 'company_id,instance_name' });
    if (upErr) lastError = `marcador não gravado: ${upErr.message}`;
    if (occupied) console.error(`[reconcile] ${occupied} mensagem(ns) com message_id de outra empresa (chave global) — empresa ${c.id}`);
    out.push({ company: c.id, windows, recovered, ...(occupied ? { occupied } : {}), ...(lastError ? { error: lastError } : {}) });
    if (Date.now() > deadline) break;
  }
  return { lines: out };
}
