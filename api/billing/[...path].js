import { adminClient, resolveUser } from '../_lib/db.js';
import { billingFor, lineCap, isValidPlan } from '../_lib/plans.js';
import crypto from 'crypto';

const ASAAS_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;
const APP_URL = process.env.APP_URL || 'https://flowmate-ashy.vercel.app';

async function asaas(path, method, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const segments = req.query?.path;
  let route = Array.isArray(segments) ? segments.join('/') : (segments || '');
  if (!route) route = (req.url || '').split('?')[0].replace(/^\/(api\/)?billing\//, '').replace(/\/+$/, '');

  if (route === 'start')    return start(req, res);    // pagamento-primeiro (público)
  if (route === 'status')   return status(req, res);   // consulta se já pagou (público)
  if (route === 'activate') return activate(req, res); // cria a conta após pagar (público)
  if (route === 'checkout') return checkout(req, res); // conta já existente (com login)
  if (route === 'webhook')  return webhook(req, res);  // Asaas → ativa/atualiza
  return res.status(404).json({ error: 'not_found' });
}

// ─── POST /api/billing/start ───
// Pagamento ANTES da conta. Cria cliente+assinatura na Asaas, guarda um cadastro
// pendente e devolve a URL do checkout hospedado.
async function start(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ASAAS_KEY) return res.status(500).json({ error: 'gateway_nao_configurado' });

  const { plan_level, plan_tier = 't1', plan_cycle = 'mensal', email, cpfCnpj } = req.body || {};
  if (!isValidPlan(plan_level, plan_tier)) return res.status(400).json({ error: 'plano_invalido' });
  if (!email) return res.status(400).json({ error: 'email_obrigatorio' });
  if (!cpfCnpj) return res.status(400).json({ error: 'cpf_cnpj_obrigatorio' });

  const plan = billingFor(plan_level, plan_tier, plan_cycle);
  const admin = adminClient();
  const token = crypto.randomUUID();

  // Cliente na Asaas
  const c = await asaas('/customers', 'POST', {
    name: email.split('@')[0], email, cpfCnpj: String(cpfCnpj).replace(/\D/g, ''),
  });
  if (!c.ok) return res.status(400).json({ error: 'erro_cliente', detail: c.data });

  // Assinatura. externalReference = token do cadastro pendente.
  const firstDue = new Date(); firstDue.setDate(firstDue.getDate() + 1);
  const sub = await asaas('/subscriptions', 'POST', {
    customer: c.data.id,
    billingType: 'UNDEFINED',
    value: plan.value,
    cycle: plan.asaasCycle,
    nextDueDate: firstDue.toISOString().slice(0, 10),
    description: `FlowMate — ${plan.label}`,
    externalReference: token,
    callback: { successUrl: `${APP_URL}/ativar?token=${token}`, autoRedirect: true },
  });
  if (!sub.ok) return res.status(400).json({ error: 'erro_assinatura', detail: sub.data });

  await admin.from('pending_signups').insert({
    signup_token: token, email,
    plan_level, plan_tier, plan_cycle,
    asaas_customer_id: c.data.id, asaas_subscription_id: sub.data.id,
    status: 'pending',
  });

  const pays = await asaas(`/payments?subscription=${sub.data.id}`, 'GET');
  const url = pays.data?.data?.[0]?.invoiceUrl || null;
  if (!url) return res.status(502).json({ error: 'sem_url_checkout' });

  return res.status(200).json({ url, token });
}

// ─── GET /api/billing/status?token=... ───
async function status(req, res) {
  const token = req.query?.token;
  if (!token) return res.status(400).json({ error: 'token_obrigatorio' });
  const admin = adminClient();
  const { data } = await admin.from('pending_signups')
    .select('status, email, plan_level, company_id').eq('signup_token', token).single();
  if (!data) return res.status(404).json({ error: 'nao_encontrado' });
  return res.status(200).json({
    status: data.status, email: data.email, plan_level: data.plan_level,
    activated: !!data.company_id,
  });
}

// ─── POST /api/billing/activate ───
// Depois de pago: cria a conta (sem confirmação de e-mail), a empresa e o plano ativo.
async function activate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const { token, password, companyName, userName } = req.body || {};
  if (!token || !password || !companyName || !userName) {
    return res.status(400).json({ error: 'campos_incompletos' });
  }
  if (String(password).length < 6) return res.status(400).json({ error: 'senha_curta' });

  const admin = adminClient();
  const { data: pending } = await admin.from('pending_signups')
    .select('*').eq('signup_token', token).single();
  if (!pending) return res.status(404).json({ error: 'cadastro_nao_encontrado' });
  if (pending.status !== 'paid') return res.status(402).json({ error: 'pagamento_pendente' });
  if (pending.company_id) return res.status(409).json({ error: 'ja_ativado' });

  // 1) Cria o usuário no Auth já confirmado (sem link de e-mail)
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email: pending.email, password, email_confirm: true,
  });
  if (uErr) return res.status(400).json({ error: uErr.message });
  const userId = created.user.id;

  // 2) Cria empresa + perfil admin (reusa o RPC existente)
  const { error: rpcErr } = await admin.rpc('register_company', {
    p_company_name: companyName, p_user_id: userId, p_user_name: userName,
  });
  if (rpcErr) return res.status(400).json({ error: rpcErr.message });

  // 3) Descobre a empresa criada e ativa o plano
  const { data: prof } = await admin.from('user_profiles').select('company_id').eq('id', userId).single();
  const companyId = prof?.company_id;
  const end = new Date(); end.setMonth(end.getMonth() + 1);
  await admin.from('companies').update({
    plan_level: pending.plan_level, plan_tier: pending.plan_tier, plan_cycle: pending.plan_cycle,
    subscription_status: 'active', line_cap: lineCap(pending.plan_tier),
    asaas_customer_id: pending.asaas_customer_id,
    asaas_subscription_id: pending.asaas_subscription_id,
    current_period_end: end.toISOString(),
  }).eq('id', companyId);

  await admin.from('pending_signups').update({ company_id: companyId }).eq('signup_token', token);

  return res.status(200).json({ ok: true, email: pending.email });
}

// ─── POST /api/billing/checkout ─── (conta já existente — trava de renovação)
async function checkout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ASAAS_KEY) return res.status(500).json({ error: 'gateway_nao_configurado' });

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'unauthorized' });

  const admin = adminClient();
  const { data: company } = await admin.from('companies')
    .select('id, name, plan_level, plan_tier, plan_cycle, asaas_customer_id')
    .eq('id', who.companyId).single();
  if (!company) return res.status(404).json({ error: 'empresa_nao_encontrada' });

  const { cpfCnpj } = req.body || {};
  if (!isValidPlan(company.plan_level, company.plan_tier)) return res.status(400).json({ error: 'plano_invalido' });
  if (!cpfCnpj) return res.status(400).json({ error: 'cpf_cnpj_obrigatorio' });

  const plan = billingFor(company.plan_level, company.plan_tier, company.plan_cycle || 'mensal');

  let customerId = company.asaas_customer_id;
  if (!customerId) {
    const c = await asaas('/customers', 'POST', { name: company.name, email: who.email, cpfCnpj: String(cpfCnpj).replace(/\D/g, '') });
    if (!c.ok) return res.status(400).json({ error: 'erro_cliente', detail: c.data });
    customerId = c.data.id;
    await admin.from('companies').update({ asaas_customer_id: customerId }).eq('id', company.id);
  }

  const firstDue = new Date(); firstDue.setDate(firstDue.getDate() + 1);
  const sub = await asaas('/subscriptions', 'POST', {
    customer: customerId, billingType: 'UNDEFINED', value: plan.value, cycle: plan.asaasCycle,
    nextDueDate: firstDue.toISOString().slice(0, 10), description: `FlowMate — ${plan.label}`,
    externalReference: company.id,
  });
  if (!sub.ok) return res.status(400).json({ error: 'erro_assinatura', detail: sub.data });
  await admin.from('companies').update({ asaas_subscription_id: sub.data.id }).eq('id', company.id);

  const pays = await asaas(`/payments?subscription=${sub.data.id}`, 'GET');
  const url = pays.data?.data?.[0]?.invoiceUrl || null;
  if (!url) return res.status(502).json({ error: 'sem_url_checkout' });
  return res.status(200).json({ url });
}

// ─── POST /api/billing/webhook ───
async function webhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (ASAAS_WEBHOOK_TOKEN) {
    if (req.headers['asaas-access-token'] !== ASAAS_WEBHOOK_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  }

  const event = req.body?.event;
  const ref = req.body?.payment?.externalReference;
  if (!ref) return res.status(200).json({ ok: true });

  const admin = adminClient();
  let status = null;
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) status = 'active';
  else if (event === 'PAYMENT_OVERDUE') status = 'past_due';
  else if (['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(event)) status = 'canceled';
  if (!status) return res.status(200).json({ ok: true });

  // Caso 1: cadastro pendente (externalReference = signup_token)
  const { data: pending } = await admin.from('pending_signups').select('company_id').eq('signup_token', ref).single();
  if (pending) {
    await admin.from('pending_signups').update({ status: status === 'active' ? 'paid' : status }).eq('signup_token', ref);
    // Se já virou empresa (renovação), reflete na empresa também
    if (pending.company_id) await applyCompanyStatus(admin, pending.company_id, status);
    return res.status(200).json({ ok: true });
  }

  // Caso 2: empresa existente (externalReference = company_id)
  await applyCompanyStatus(admin, ref, status);
  return res.status(200).json({ ok: true });
}

async function applyCompanyStatus(admin, companyId, status) {
  const patch = { subscription_status: status };
  if (status === 'active') {
    const { data: company } = await admin.from('companies').select('plan_tier').eq('id', companyId).single();
    patch.line_cap = lineCap(company?.plan_tier);
    const end = new Date(); end.setMonth(end.getMonth() + 1);
    patch.current_period_end = end.toISOString();
  }
  await admin.from('companies').update(patch).eq('id', companyId);
}
