// CF-A · A5 — Saúde e alertas (PLANO-CONFIABILIDADE.md).
//
// - lineHealth: saúde da linha de UMA empresa (tela de saúde do admin; chave `health`).
// - probe: verificação curta para o monitor externo (UptimeRobot/BetterStack): banco e
//   Evolution respondendo. Sem login e sem detalhe nenhum na resposta.
// - evaluateAlerts: abre/fecha alertas em ops_alerts (no máximo um ABERTO por empresa + tipo +
//   assunto) e avisa por e-mail os recém-abertos.
//     · alertas de LINHA só para empresas com a chave `health_alerts`;
//     · line_silent: linha "connected" que parou de receber (ver evaluateSilence);
//     · alertas de INFRA (Evolution fora) só com a variável OPS_ALERTS=on.
//   Sem RESEND_API_KEY / OPS_ALERT_EMAIL, o alerta é gravado e fica sem aviso (notified_at nulo).
// - Disco da Evolution: a Evolution não expõe. Fica de fora até haver token da API do Railway
//   (a confirmar) — ver o relatório CF-A5.

export const LINE_DOWN_AFTER_MS = 5 * 60_000;      // desconectada há mais de 5 min
export const WRITE_FAILING_MIN = 3;                // eventos 'failed' com 3+ tentativas
const EVO_TIMEOUT_MS = 5_000;

// Pergunta à Evolution se está viva (GET /). evoFetch(path) → { ok, status, json }.
export async function evolutionUp(evoFetch) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      evoFetch('/'),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, status: 0, timeout: true }), EVO_TIMEOUT_MS)),
    ]);
    return { ok: !!r?.ok, ms: Date.now() - t0, status: r?.status ?? 0, version: r?.json?.version || null, timeout: !!r?.timeout };
  } catch {
    return { ok: false, ms: Date.now() - t0, status: 0, version: null };
  }
}

async function countInbound(db, companyId, status, extra) {
  let q = db.from('inbound_events').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('status', status);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw new Error(`inbound_events: ${error.message}`);
  return count || 0;
}

// Saúde da linha de uma empresa (só leitura).
export async function lineHealth(db, companyId, { evoFetch, now = Date.now() } = {}) {
  const { data: inst, error: iErr } = await db.from('whatsapp_instances')
    .select('instance_name, status, phone, updated_at').eq('company_id', companyId).maybeSingle();
  if (iErr) throw new Error(`whatsapp_instances: ${iErr.message}`);

  const { data: lastIn, error: mErr } = await db.from('whatsapp_messages')
    .select('timestamp').eq('company_id', companyId).eq('from_me', false)
    .order('timestamp', { ascending: false }).limit(1);
  if (mErr) throw new Error(`whatsapp_messages: ${mErr.message}`);

  const inbound = {
    pending: await countInbound(db, companyId, 'pending'),
    failed: await countInbound(db, companyId, 'failed'),
    dead: await countInbound(db, companyId, 'dead'),
  };

  const { data: sync } = inst
    ? await db.from('line_sync_state').select('reconciled_until, last_run_at, last_ok_at, last_recovered, recovered_total, last_error')
        .eq('company_id', companyId).eq('instance_name', inst.instance_name).maybeSingle()
    : { data: null };

  const { data: alerts } = await db.from('ops_alerts')
    .select('kind, subject, detail, opened_at, last_seen_at')
    .eq('company_id', companyId).is('resolved_at', null).order('opened_at', { ascending: false });

  const evolution = evoFetch ? await evolutionUp(evoFetch) : null;
  const phone = inst?.phone ? `…${String(inst.phone).slice(-4)}` : null;  // só o final

  return {
    line: inst ? { instance_name: inst.instance_name, status: inst.status, phone, status_since: inst.updated_at } : null,
    last_inbound_at: lastIn?.[0]?.timestamp ? new Date(Number(lastIn[0].timestamp) * 1000).toISOString() : null,
    inbound,
    reconcile: sync || null,
    alerts: alerts || [],
    evolution,
    checked_at: new Date(now).toISOString(),
  };
}

// Verificação para o monitor externo. → { ok, failing: [...] } (sem detalhe).
export async function probe(db, evoFetch) {
  const failing = [];
  try {
    const { error } = await db.from('companies').select('id', { head: true, count: 'exact' }).limit(1);
    if (error) failing.push('database');
  } catch { failing.push('database'); }
  const evo = await evolutionUp(evoFetch);
  if (!evo.ok) failing.push('evolution');
  return { ok: failing.length === 0, failing };
}

// ── alertas ──────────────────────────────────────────────────────────────────

// Abre (ou renova) um alerta. Índice parcial único → insert e, no 23505, só atualiza last_seen.
async function openAlert(db, { companyId, kind, subject, detail }) {
  const { error } = await db.from('ops_alerts').insert({ company_id: companyId, kind, subject, detail });
  if (!error) return { opened: true };
  if (error.code !== '23505') throw new Error(`ops_alerts: ${error.message}`);
  let q = db.from('ops_alerts').update({ last_seen_at: new Date().toISOString(), detail })
    .eq('kind', kind).eq('subject', subject).is('resolved_at', null);
  q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null);
  const { error: uErr } = await q;
  if (uErr) console.error(`[alerts] renovação falhou (${kind}): ${uErr.message}`);
  return { opened: false };
}

async function resolveAlert(db, { companyId, kind, subject }) {
  let q = db.from('ops_alerts').update({ resolved_at: new Date().toISOString() })
    .eq('kind', kind).eq('subject', subject).is('resolved_at', null);
  q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null);
  const { error } = await q;
  if (error) console.error(`[alerts] resolução falhou (${kind}): ${error.message}`);
}

// Envia por e-mail os alertas abertos ainda não avisados. sendEmail é injetável (teste).
export async function notifyPending(db, { sendEmail = sendAlertEmail } = {}) {
  const { data: pend, error } = await db.from('ops_alerts')
    .select('id, company_id, kind, subject, detail, opened_at')
    .is('resolved_at', null).is('notified_at', null).limit(20);
  if (error || !pend?.length) return { sent: 0 };
  let sent = 0;
  for (const a of pend) {
    const ok = await sendEmail({
      subject: `[FlowMate] ${ALERT_TEXT[a.kind] || a.kind}: ${a.subject}`,
      text: `${ALERT_TEXT[a.kind] || a.kind}\nAssunto: ${a.subject}\nEmpresa: ${a.company_id || '(infraestrutura)'}\nDesde: ${a.opened_at}\n${a.detail || ''}`,
    });
    if (ok) { await db.from('ops_alerts').update({ notified_at: new Date().toISOString() }).eq('id', a.id); sent++; }
  }
  return { sent };
}

const ALERT_TEXT = {
  line_disconnected: 'Linha de WhatsApp desconectada',
  line_silent: 'Linha conectada, mas sem receber mensagens',
  write_failing: 'Mensagens recebidas não estão sendo gravadas',
  dead_events: 'Eventos na fila de mortos',
  evolution_down: 'Evolution API fora do ar',
  disk_high: 'Disco da Evolution acima de 70%',
};

// Resend (https://resend.com). Sem as variáveis → não envia (false).
export async function sendAlertEmail({ subject, text }) {
  const key = process.env.RESEND_API_KEY, to = process.env.OPS_ALERT_EMAIL;
  if (!key || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.OPS_ALERT_FROM || 'FlowMate <onboarding@resend.dev>', to: [to], subject, text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) console.error(`[alerts] e-mail falhou: ${r.status}`);
    return r.ok;
  } catch (e) {
    console.error(`[alerts] e-mail falhou: ${e?.message || e}`);
    return false;
  }
}

// ── linha silenciosa (line_silent) ──────────────────────────────────────────
// A linha segue "connected", mas a sessão do WhatsApp pode ter travado e parado de receber:
// line_disconnected não pega isso. Critério: silêncio de mensagens RECEBIDAS contado só na
// janela comercial, com limite proporcional ao movimento normal da linha.
const SILENT_TZ_OFFSET_MS = 3 * 3_600_000;   // BRT = UTC-3, fixo (o Brasil não tem horário de verão)
const SILENT_DAY_START_H = 8, SILENT_DAY_END_H = 20;
const SILENT_MIN_MS = 60 * 60_000;           // limite mínimo
const SILENT_MAX_MS = 4 * 3_600_000;         // teto do limite
const SILENT_INTERVAL_FACTOR = 4;
const SILENT_MIN_ACTIVE_DAYS = 3;            // dias com mensagem recebida, entre os últimos 7
const SILENT_EVO_MARGIN_S = 60;              // folga para o webhook ainda em trânsito
const DAY_MS = 86_400_000;

// d = meia-noite BRT do dia, como se fosse UTC (só para saber o dia da semana e somar horas).
const brtDayStart = t => Math.floor((t - SILENT_TZ_OFFSET_MS) / DAY_MS) * DAY_MS;

// Janela (em ms reais) do dia d, ou null no domingo.
function windowOfDay(d) {
  if (new Date(d).getUTCDay() === 0) return null;
  const start = d + SILENT_TZ_OFFSET_MS + SILENT_DAY_START_H * 3_600_000;
  return { start, end: start + (SILENT_DAY_END_H - SILENT_DAY_START_H) * 3_600_000 };
}

// Tempo (ms) entre from e to que cai na janela 08:00–20:00 BRT, segunda a sábado.
export function silentWindowMs(from, to) {
  let total = 0;
  for (let d = brtDayStart(from); d <= brtDayStart(to); d += DAY_MS) {
    const w = windowOfDay(d);
    if (w) total += Math.max(0, Math.min(to, w.end) - Math.max(from, w.start));
  }
  return total;
}

// Limite a partir do movimento: maior entre 60 min e 4 × intervalo médio, com teto de 4 h.
export function silentLimitMs({ count, windowMs }) {
  const mean = count > 0 ? windowMs / count : SILENT_MAX_MS;
  return Math.min(SILENT_MAX_MS, Math.max(SILENT_MIN_MS, SILENT_INTERVAL_FACTOR * mean));
}

// Movimento dos 7 dias completos anteriores a `ref` (a última recebida: os dias mortos não entram
// na conta), só dentro da janela. Uma contagem por dia, pelo índice company_id + timestamp.
// Erro de leitura lança: quem chama não mexe no alerta.
async function silentBaseline(db, companyId, ref) {
  let activeDays = 0, count = 0, windowMs = 0;
  const today = brtDayStart(ref);
  for (let i = 1; i <= 7; i++) {
    const w = windowOfDay(today - i * DAY_MS);
    if (!w) continue;
    const { count: n, error } = await db.from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('from_me', false)
      .gte('timestamp', Math.floor(w.start / 1000)).lt('timestamp', Math.floor(w.end / 1000));
    if (error) throw new Error(`whatsapp_messages: ${error.message}`);
    windowMs += w.end - w.start;
    count += n || 0;
    if (n) activeDays++;
  }
  return { activeDays, count, windowMs };
}

function brtClock(sec) {
  const iso = new Date(sec * 1000 - SILENT_TZ_OFFSET_MS).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

// A Evolution tem mensagem recebida mais nova que o FlowMate? Separa webhook de sessão travada.
// (Na 2.3.7 o filtro fromMe:false é ignorado: filtra aqui, entre as mais novas.)
async function silentDiagnosis(evoFetch, instanceName, lastInSec, deadline) {
  const timeLeft = Math.min(EVO_TIMEOUT_MS, deadline - Date.now());
  if (!evoFetch || timeLeft <= 0) return 'Evolution não consultada; causa não verificada.';
  try {
    const r = await Promise.race([
      evoFetch(`/chat/findMessages/${instanceName}`, { method: 'POST', body: { where: {}, page: 1, offset: 20 } }),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: true }), timeLeft)),
    ]);
    const recs = r?.json?.messages?.records;
    if (!r?.ok || !Array.isArray(recs)) return 'Evolution não respondeu; causa não verificada.';
    const newest = recs.filter(m => m?.key?.fromMe === false).map(m => Number(m.messageTimestamp)).filter(Boolean)
      .reduce((a, b) => Math.max(a, b), 0);
    // Nenhuma recebida entre as mais novas: não dá para afirmar nada.
    if (!newest) return 'Evolution sem recebidas recentes para comparar; causa não verificada.';
    if (newest > lastInSec + SILENT_EVO_MARGIN_S) {
      return `Evolution recebeu em ${brtClock(newest)} e o FlowMate não: provável webhook/entrega.`;
    }
    return 'Evolution também parada: provável sessão do WhatsApp travada.';
  } catch {
    return 'Evolution não respondeu; causa não verificada.';
  }
}

// Avalia uma linha conectada. → { silent: true, detail } | { silent: false }.
// Leitura com erro lança: o alerta fica como está (nem abre nem fecha por falta de dado).
// open: o alerta aberto ({ detail, opened_at }), se houver. Aberto, só fecha quando chega
// mensagem: sem novas contagens nem nova consulta à Evolution (a causa é a vista na abertura).
export async function evaluateSilence(db, { companyId, instanceName, evoFetch, now = Date.now(), open = null, deadline = Date.now() + EVO_TIMEOUT_MS }) {
  const { data: lastIn, error } = await db.from('whatsapp_messages')
    .select('timestamp').eq('company_id', companyId).eq('from_me', false)
    .order('timestamp', { ascending: false }).limit(1);
  if (error) throw new Error(`whatsapp_messages: ${error.message}`);
  const lastInSec = Number(lastIn?.[0]?.timestamp);
  if (!lastInSec) return { silent: false };
  if (open && lastInSec * 1000 <= new Date(open.opened_at).getTime()) return { silent: true, detail: open.detail };
  const silence = silentWindowMs(lastInSec * 1000, now);
  if (silence < SILENT_MIN_MS) return { silent: false };   // caminho comum: sem as contagens
  // Alerta novo só abre dentro da janela (à noite e no domingo, nem as contagens).
  const w = windowOfDay(brtDayStart(now));
  if (!w || now < w.start || now >= w.end) return { silent: false };
  const base = await silentBaseline(db, companyId, lastInSec * 1000);
  if (base.activeDays < SILENT_MIN_ACTIVE_DAYS) return { silent: false };
  const limit = silentLimitMs(base);
  if (silence < limit) return { silent: false };
  const cause = await silentDiagnosis(evoFetch, instanceName, lastInSec, deadline);
  return {
    silent: true,
    detail: `Sem mensagem recebida em horário comercial além do limite de ${Math.round(limit / 60_000)} min; última em ${brtClock(lastInSec)} BRT. ${cause}`,
  };
}

// Uma rodada de alertas. Devolve um resumo. evoFetch/sendEmail injetáveis.
// deadline: depois dele, o diagnóstico do line_silent não consulta a Evolution (o aviso por e-mail,
// no fim, não pode ficar sem tempo).
export async function evaluateAlerts(db, { evoFetch, sendEmail, now = Date.now(), infraOn = process.env.OPS_ALERTS === 'on', deadline = Date.now() + 5_000 } = {}) {
  const summary = { checked: 0, opened: 0 };
  const touch = async (cond, a) => {
    if (cond) { const r = await openAlert(db, a); if (r.opened) summary.opened++; }
    else await resolveAlert(db, a);
  };

  if (infraOn && evoFetch) {
    const evo = await evolutionUp(evoFetch);
    await touch(!evo.ok, { companyId: null, kind: 'evolution_down', subject: 'evolution',
      detail: evo.timeout ? 'sem resposta em 5 s' : `status ${evo.status}` });
  }

  const { data: comps, error } = await db.from('companies').select('id').eq('features->>health_alerts', 'true');
  if (error) return { ...summary, error: error.message };
  for (const c of comps || []) {
    summary.checked++;
    const { data: inst } = await db.from('whatsapp_instances')
      .select('instance_name, status, updated_at').eq('company_id', c.id).maybeSingle();
    const subject = inst?.instance_name || 'sem-instancia';
    const since = inst?.updated_at ? new Date(inst.updated_at).getTime() : now;
    await touch(!!inst && inst.status !== 'connected' && now - since > LINE_DOWN_AFTER_MS,
      { companyId: c.id, kind: 'line_disconnected', subject, detail: `status ${inst?.status}` });
    // Conectada e muda. Desconectada há mais de 5 min: vale o alerta acima. Queda breve: não mexe
    // (fechar e reabrir mandaria e-mail a cada volta). Erro de leitura: deixa como está.
    try {
      if (inst?.status === 'connected') {
        const { data: open, error: oErr } = await db.from('ops_alerts').select('detail, opened_at')
          .eq('company_id', c.id).eq('kind', 'line_silent').eq('subject', subject).is('resolved_at', null).maybeSingle();
        if (oErr) throw new Error(`ops_alerts: ${oErr.message}`);
        const s = await evaluateSilence(db, { companyId: c.id, instanceName: inst.instance_name, evoFetch, now, open, deadline });
        await touch(s.silent, { companyId: c.id, kind: 'line_silent', subject, detail: s.detail });
      } else if (now - since > LINE_DOWN_AFTER_MS) {
        await resolveAlert(db, { companyId: c.id, kind: 'line_silent', subject });
      }
    } catch (e) { console.error(`[alerts] line_silent não avaliado: ${e?.message || e}`); }
    const dead = await countInbound(db, c.id, 'dead');
    await touch(dead > 0, { companyId: c.id, kind: 'dead_events', subject, detail: `${dead} evento(s)` });
    const failing = await countInbound(db, c.id, 'failed', q => q.gte('attempts', WRITE_FAILING_MIN));
    await touch(failing > 0, { companyId: c.id, kind: 'write_failing', subject, detail: `${failing} evento(s) com ${WRITE_FAILING_MIN}+ tentativas` });
  }

  const n = await notifyPending(db, { sendEmail });
  return { ...summary, notified: n.sent };
}
