import { adminClient, resolveUser } from '../_lib/db.js';
import { billingFor, lineCap, isValidPlan } from '../_lib/plans.js';
import crypto from 'crypto';

// ─── AbacatePay (v1) ─────────────────────────────────────────────────────────
// Provedor de pagamento. Cobrança avulsa (ONE_TIME) com produto INLINE — o preço
// sai do plans.js (servidor manda). PIX/cartão via checkout hospedado; o aviso de
// pago chega por webhook (evento billing.paid). Assinatura automática no cartão
// (recorrência de verdade) é Fase 2 (API v2), ainda não implementada.
const ABACATE_URL = 'https://api.abacatepay.com/v1';
const ABACATE_KEY = process.env.ABACATEPAY_API_KEY;
const ABACATE_WEBHOOK_SECRET = process.env.ABACATEPAY_WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL || 'https://flowmate-ashy.vercel.app';

async function abacate(path, method, body) {
  const res = await fetch(`${ABACATE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ABACATE_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  // AbacatePay responde { data, error } — sucesso = HTTP ok E sem error.
  return { ok: res.ok && !json.error, status: res.status, data: json.data, error: json.error };
}

// Monta o payload de cobrança avulsa. externalId no produto = referência do plano.
// A correlação com o webhook é pelo billing id (guardado no banco).
function buildBilling(plan, { plan_level, plan_tier, plan_cycle, name, email, cpfCnpj, cellphone }, token) {
  return {
    frequency: 'ONE_TIME',
    methods: ['PIX'], // TODO devMode: incluir 'CARD' quando o cartão estiver habilitado
    products: [{
      externalId: `${plan_level}_${plan_tier}_${plan_cycle}`,
      name: `FlowMate — ${plan.label}`,
      quantity: 1,
      price: Math.round(plan.value * 100), // centavos
    }],
    returnUrl: `${APP_URL}/ativar?token=${token}`,
    completionUrl: `${APP_URL}/ativar?token=${token}`,
    customer: {
      name: (name && name.trim()) || email.split('@')[0],
      email,
      taxId: String(cpfCnpj).replace(/\D/g, ''),
      ...(cellphone ? { cellphone: String(cellphone).replace(/\D/g, '') } : {}),
    },
  };
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
  if (route === 'webhook')  return webhook(req, res);  // AbacatePay → ativa/atualiza
  return res.status(404).json({ error: 'not_found' });
}

// ─── POST /api/billing/start ───
// Pagamento ANTES da conta. Cria a cobrança no AbacatePay, guarda um cadastro
// pendente e devolve a URL do checkout hospedado.
async function start(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ABACATE_KEY) return res.status(500).json({ error: 'gateway_nao_configurado' });

  const { plan_level, plan_tier = 't1', plan_cycle = 'mensal', email, cpfCnpj, name, cellphone } = req.body || {};
  if (!isValidPlan(plan_level, plan_tier)) return res.status(400).json({ error: 'plano_invalido' });
  if (!email) return res.status(400).json({ error: 'email_obrigatorio' });
  if (!cpfCnpj) return res.status(400).json({ error: 'cpf_cnpj_obrigatorio' });
  if (!cellphone) return res.status(400).json({ error: 'telefone_obrigatorio' });

  const plan = billingFor(plan_level, plan_tier, plan_cycle);
  const admin = adminClient();
  const token = crypto.randomUUID();

  const bill = await abacate('/billing/create', 'POST',
    buildBilling(plan, { plan_level, plan_tier, plan_cycle, name, email, cpfCnpj, cellphone }, token));
  if (!bill.ok) return res.status(400).json({ error: 'erro_cobranca', detail: bill.error });

  const url = bill.data?.url;
  const billingId = bill.data?.id;
  if (!url) return res.status(502).json({ error: 'sem_url_checkout' });

  await admin.from('pending_signups').insert({
    signup_token: token, email,
    plan_level, plan_tier, plan_cycle,
    abacate_customer_id: bill.data?.customer?.id || bill.data?.customer?.metadata?.id || null,
    abacate_billing_id: billingId,
    status: 'pending',
  });

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
    abacate_customer_id: pending.abacate_customer_id,
    abacate_billing_id: pending.abacate_billing_id,
    current_period_end: end.toISOString(),
  }).eq('id', companyId);

  await admin.from('pending_signups').update({ company_id: companyId }).eq('signup_token', token);

  return res.status(200).json({ ok: true, email: pending.email });
}

// ─── POST /api/billing/checkout ─── (conta já existente — renovação/reativação)
async function checkout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ABACATE_KEY) return res.status(500).json({ error: 'gateway_nao_configurado' });

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'unauthorized' });

  const admin = adminClient();
  const { data: company } = await admin.from('companies')
    .select('id, name, plan_level, plan_tier, plan_cycle, abacate_customer_id')
    .eq('id', who.companyId).single();
  if (!company) return res.status(404).json({ error: 'empresa_nao_encontrada' });

  const { cpfCnpj, cellphone } = req.body || {};
  if (!isValidPlan(company.plan_level, company.plan_tier)) return res.status(400).json({ error: 'plano_invalido' });
  if (!cpfCnpj) return res.status(400).json({ error: 'cpf_cnpj_obrigatorio' });
  if (!cellphone) return res.status(400).json({ error: 'telefone_obrigatorio' });

  const plan = billingFor(company.plan_level, company.plan_tier, company.plan_cycle || 'mensal');

  // Cobrança avulsa da renovação. Correlação pelo billing id (guardado na empresa).
  const bill = await abacate('/billing/create', 'POST',
    buildBilling(plan, {
      plan_level: company.plan_level, plan_tier: company.plan_tier, plan_cycle: company.plan_cycle || 'mensal',
      name: company.name, email: who.email, cpfCnpj, cellphone,
    }, company.id));
  if (!bill.ok) return res.status(400).json({ error: 'erro_cobranca', detail: bill.error });

  const url = bill.data?.url;
  if (!url) return res.status(502).json({ error: 'sem_url_checkout' });

  await admin.from('companies').update({
    abacate_billing_id: bill.data?.id,
    abacate_customer_id: company.abacate_customer_id || bill.data?.customer?.id || null,
  }).eq('id', company.id);

  return res.status(200).json({ url });
}

// ─── POST /api/billing/webhook ───
// AbacatePay chama com o secret na query (?webhookSecret=...). Evento billing.paid = pago.
async function webhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (ABACATE_WEBHOOK_SECRET) {
    // O secret pode chegar na query (?webhookSecret=) ou em header — aceita ambos.
    const h = req.headers || {};
    const provided = req.query?.webhookSecret
      || h['webhook-secret'] || h['x-webhook-secret'] || h['x-abacatepay-webhook-secret'];
    if (provided !== ABACATE_WEBHOOK_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }

  const event = req.body?.event;
  const paid = event === 'billing.paid' || event === 'checkout.completed';

  // Localiza o billing id no payload (defensivo — confirmar shape exato em devMode).
  const b = req.body?.data || {};
  const billingId = b.billing?.id || b.id || b.payment?.billing?.id || req.body?.billing?.id || null;

  if (!paid || !billingId) return res.status(200).json({ ok: true }); // ignora eventos que não interessam

  const admin = adminClient();

  // Caso 1: cadastro pendente (pagamento-primeiro)
  const { data: pending } = await admin.from('pending_signups')
    .select('company_id').eq('abacate_billing_id', billingId).single();
  if (pending) {
    await admin.from('pending_signups').update({ status: 'paid' }).eq('abacate_billing_id', billingId);
    if (pending.company_id) await applyCompanyStatus(admin, pending.company_id, 'active'); // renovação já ativada
    return res.status(200).json({ ok: true });
  }

  // Caso 2: empresa existente (renovação) — correlação pelo billing id na empresa
  const { data: company } = await admin.from('companies')
    .select('id').eq('abacate_billing_id', billingId).single();
  if (company) await applyCompanyStatus(admin, company.id, 'active');

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
