import { adminClient, resolveUser } from '../_lib/db.js';
import { billingFor, lineCap, isValidPlan } from '../_lib/plans.js';

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
  const segments = req.query?.path;
  let route = Array.isArray(segments) ? segments.join('/') : (segments || '');
  if (!route) route = (req.url || '').split('?')[0].replace(/^\/(api\/)?billing\//, '').replace(/\/+$/, '');

  if (route === 'checkout')  return checkout(req, res);
  if (route === 'webhook')   return webhook(req, res);
  return res.status(404).json({ error: 'not_found' });
}

// ─── POST /api/billing/checkout ───
// Cria (ou reusa) o cliente na Asaas, cria a assinatura recorrente do plano
// e devolve a URL do checkout hospedado (onde o cliente paga PIX/boleto/cartão).
async function checkout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ASAAS_KEY) return res.status(500).json({ error: 'gateway_nao_configurado' });

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'unauthorized' });

  const admin = adminClient();
  const { data: company } = await admin
    .from('companies')
    .select('id, name, plan_level, plan_tier, plan_cycle, asaas_customer_id')
    .eq('id', who.companyId).single();
  if (!company) return res.status(404).json({ error: 'empresa_nao_encontrada' });

  const { cpfCnpj, email } = req.body || {};
  const level = company.plan_level, tier = company.plan_tier, cycle = company.plan_cycle || 'mensal';
  if (!isValidPlan(level, tier)) return res.status(400).json({ error: 'plano_invalido' });
  if (!cpfCnpj) return res.status(400).json({ error: 'cpf_cnpj_obrigatorio' });

  const plan = billingFor(level, tier, cycle);

  // 1) Cliente na Asaas (cria se ainda não existe)
  let customerId = company.asaas_customer_id;
  if (!customerId) {
    const c = await asaas('/customers', 'POST', {
      name: company.name,
      email: email || who.email || undefined,
      cpfCnpj: String(cpfCnpj).replace(/\D/g, ''),
    });
    if (!c.ok) return res.status(400).json({ error: 'erro_cliente', detail: c.data });
    customerId = c.data.id;
    await admin.from('companies').update({ asaas_customer_id: customerId }).eq('id', company.id);
  }

  // 2) Assinatura recorrente. externalReference = company_id (o webhook usa pra ativar o tenant).
  const firstDue = new Date();
  firstDue.setDate(firstDue.getDate() + 1);
  const sub = await asaas('/subscriptions', 'POST', {
    customer: customerId,
    billingType: 'UNDEFINED', // deixa o cliente escolher PIX / boleto / cartão no checkout
    value: plan.value,
    cycle: plan.asaasCycle,
    nextDueDate: firstDue.toISOString().slice(0, 10),
    description: `FlowMate — ${plan.label}`,
    externalReference: company.id,
  });
  if (!sub.ok) return res.status(400).json({ error: 'erro_assinatura', detail: sub.data });

  await admin.from('companies')
    .update({ asaas_subscription_id: sub.data.id, subscription_status: 'pending' })
    .eq('id', company.id);

  // 3) Pega a 1ª cobrança e devolve a URL do checkout hospedado
  const pays = await asaas(`/payments?subscription=${sub.data.id}`, 'GET');
  const first = pays.data?.data?.[0];
  const url = first?.invoiceUrl || first?.bankSlipUrl || null;
  if (!url) return res.status(502).json({ error: 'sem_url_checkout', detail: pays.data });

  return res.status(200).json({ url });
}

// ─── POST /api/billing/webhook ───
// A Asaas chama aqui quando o pagamento muda de estado. Autentica pelo token
// que você configura no painel da Asaas (header asaas-access-token).
async function webhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (ASAAS_WEBHOOK_TOKEN) {
    const token = req.headers['asaas-access-token'];
    if (token !== ASAAS_WEBHOOK_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  }

  const event = req.body?.event;
  const payment = req.body?.payment;
  const companyId = payment?.externalReference;
  if (!companyId) return res.status(200).json({ ok: true }); // nada a fazer

  const admin = adminClient();

  // Confirmou/recebeu → ativa. Vencido → past_due. Estornado/deletado → canceled.
  let status = null;
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) status = 'active';
  else if (['PAYMENT_OVERDUE'].includes(event)) status = 'past_due';
  else if (['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(event)) status = 'canceled';

  if (status) {
    const patch = { subscription_status: status };
    if (status === 'active') {
      // libera o teto de linhas da faixa e marca o fim do período
      const { data: company } = await admin.from('companies').select('plan_tier').eq('id', companyId).single();
      patch.line_cap = lineCap(company?.plan_tier);
      const end = new Date();
      end.setMonth(end.getMonth() + 1);
      patch.current_period_end = end.toISOString();
    }
    await admin.from('companies').update(patch).eq('id', companyId);
  }

  return res.status(200).json({ ok: true });
}
