// ─────────────────────────────────────────────────────────────────────────────
// CONFIG DE PLANOS — FlowMate
//
// ⚠️ PREÇOS SÃO PLACEHOLDER. Não anunciar publicamente nem aceitar pagante até
// o Agadir validar o custo real por linha (quantas linhas cabem por VPS + RAG).
// Enquanto PUBLISHED = false, a landing mostra um aviso de "prévia".
//
// Para trocar os preços: edite o objeto PRICES abaixo. É a única fonte.
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLISHED = false; // vira true só quando o Agadir liberar preço público

// Desconto do plano anual (aplicado sobre 12x o mensal)
export const ANNUAL_DISCOUNT = 0.23; // ~23%

// Faixas: unidade cobrada = LINHA (número de WhatsApp conectado)
export const TIERS = [
  { id: 't1', label: '1 a 5 linhas',   min: 1,  max: 5  },
  { id: 't2', label: '6 a 10 linhas',  min: 6,  max: 10 },
  { id: 't3', label: '11 a 16 linhas', min: 11, max: 16 },
  { id: 'custom', label: '16+ linhas', min: 16, max: null, contact: true },
];

// Níveis: diferenciam por RECURSO, não por quantidade de linha.
// ⚠️ features[] entram na copy pública — cada uma tem que ser verdadeira HOJE.
export const LEVELS = [
  {
    id: 'essencial',
    name: 'Essencial',
    tagline: 'O CRM completo.',
    features: [
      'Inbox unificada de WhatsApp',
      'Funil / pipeline (múltiplos funis)',
      'Campos personalizados',
      'Contatos, tags e notas',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Traga sua automação.',
    highlight: true, // "mais popular"
    features: [
      'Tudo do Essencial',
      'API e webhooks (n8n, Make, Zapier)',
      'Estado automação / humano por conversa',
      'Webhooks assinados (HMAC)',
    ],
  },
  {
    id: 'avancado',
    name: 'Avançado',
    tagline: 'Escala com suporte.',
    features: [
      'Tudo do Pro',
      'Suporte dedicado',
      'Relatórios avançados',
    ],
  },
];

// PREÇOS MENSAIS por (nível × faixa) — em R$. PLACEHOLDER.
// null = sem preço automático (faixa "custom" / 16+ → fale conosco).
export const PRICES = {
  essencial: { t1: 149, t2: 269, t3: 429, custom: null },
  pro:       { t1: 249, t2: 439, t3: 690, custom: null },
  avancado:  { t1: 399, t2: 690, t3: 990, custom: null },
};

// ─── helpers ───
export function monthlyPrice(levelId, tierId) {
  return PRICES[levelId]?.[tierId] ?? null;
}

// Preço anual "por mês" (com desconto), a partir do mensal.
export function annualMonthly(levelId, tierId) {
  const m = monthlyPrice(levelId, tierId);
  if (m == null) return null;
  return Math.round(m * (1 - ANNUAL_DISCOUNT));
}

export function annualTotal(levelId, tierId) {
  const am = annualMonthly(levelId, tierId);
  if (am == null) return null;
  return am * 12;
}

export function formatBRL(v) {
  if (v == null) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
