// Paleta das etiquetas (PLANO-ETIQUETAS: 8 cores fixas + cinza padrão, aprovada em 2026-10-13).
// Fonte única: servidor (validação da /v1 e da tela) e front (seletor de cor). Sem dependências
// de Node — este arquivo também é importado pelo navegador.
// As cores das etiquetas de sistema (âmbar e índigo, do SQL da CF-A) estão na paleta.
export const DEFAULT_LABEL_COLOR = '#64748b';

export const LABEL_COLORS = [
  { color: '#64748b', name: 'Cinza' },
  { color: '#ef4444', name: 'Vermelho' },
  { color: '#f97316', name: 'Laranja' },
  { color: '#f59e0b', name: 'Âmbar' },
  { color: '#22c55e', name: 'Verde' },
  { color: '#14b8a6', name: 'Turquesa' },
  { color: '#3b82f6', name: 'Azul' },
  { color: '#6366f1', name: 'Índigo' },
  { color: '#ec4899', name: 'Rosa' },
];

// Cor da paleta (sem diferenciar caixa) → a forma gravada (minúsculas). Fora da paleta → null.
export function paletteColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return LABEL_COLORS.some(c => c.color === v) ? v : null;
}
