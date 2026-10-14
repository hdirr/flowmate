// CF-A · A5 — Saúde e alertas (PLANO-CONFIABILIDADE.md).
//
// - lineHealth: saúde da linha de UMA empresa (tela de saúde do admin; chave `health`).
// - probe: verificação curta para o monitor externo (UptimeRobot/BetterStack): banco e
//   Evolution respondendo. Sem login e sem detalhe nenhum na resposta.
// - evaluateAlerts: abre/fecha alertas em ops_alerts (no máximo um ABERTO por empresa + tipo +
//   assunto) e avisa por e-mail os recém-abertos.
//     · alertas de LINHA só para empresas com a chave `health_alerts`;
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

// Uma rodada de alertas. Devolve um resumo. evoFetch/sendEmail injetáveis.
export async function evaluateAlerts(db, { evoFetch, sendEmail, now = Date.now(), infraOn = process.env.OPS_ALERTS === 'on' } = {}) {
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
    const dead = await countInbound(db, c.id, 'dead');
    await touch(dead > 0, { companyId: c.id, kind: 'dead_events', subject, detail: `${dead} evento(s)` });
    const failing = await countInbound(db, c.id, 'failed', q => q.gte('attempts', WRITE_FAILING_MIN));
    await touch(failing > 0, { companyId: c.id, kind: 'write_failing', subject, detail: `${failing} evento(s) com ${WRITE_FAILING_MIN}+ tentativas` });
  }

  const n = await notifyPending(db, { sendEmail });
  return { ...summary, notified: n.sent };
}
