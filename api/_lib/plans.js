// Fonte AUTORITATIVA de preço e teto de linhas — usada na cobrança (servidor).
// O src/lib/pricing.js é só exibição; o preço cobrado sai DAQUI. Mantenha em sincronia.

const ANNUAL_DISCOUNT = 0.23;

// Preço MENSAL por (nível × faixa), em R$.
const PRICES = {
  essencial: { t1: 149, t2: 269, t3: 429 },
  pro:       { t1: 249, t2: 439, t3: 690 },
  avancado:  { t1: 399, t2: 690, t3: 990 },
};

// Teto de linhas (números de WhatsApp) por faixa.
const TIER_CAP = { t1: 5, t2: 10, t3: 16 };

const LEVELS = ['essencial', 'pro', 'avancado'];
const TIERS = ['t1', 't2', 't3'];

export function isValidPlan(level, tier) {
  return LEVELS.includes(level) && TIERS.includes(tier);
}

export function lineCap(tier) {
  return TIER_CAP[tier] ?? 0;
}

// Retorna o que a Asaas precisa: valor e ciclo.
// mensal → cobra o mensal todo mês. anual → cobra o total do ano, uma vez por ano.
export function billingFor(level, tier, cycle) {
  if (!isValidPlan(level, tier)) return null;
  const monthly = PRICES[level][tier];
  if (cycle === 'anual') {
    const monthlyDiscounted = Math.round(monthly * (1 - ANNUAL_DISCOUNT));
    return { value: monthlyDiscounted * 12, asaasCycle: 'YEARLY', label: `${level} ${tier} anual` };
  }
  return { value: monthly, asaasCycle: 'MONTHLY', label: `${level} ${tier} mensal` };
}
