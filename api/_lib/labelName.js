// Nome padronizado (slug) das etiquetas de usuário — fonte única (servidor e front; sem
// dependências de Node). Regra: minúsculas, sem acento, qualquer coisa fora de a-z/0-9 vira
// hífen, sem hífen repetido nem nas pontas. "Promoção Natal" → "promocao-natal".
// As etiquetas de SISTEMA ("Atendimento humano", "Atendimento IA") não passam por aqui: mantêm o
// nome e nunca são renomeadas. Como um slug nunca tem maiúscula nem espaço, uma etiqueta de
// usuário "atendimento-ia" não conflita com elas.
// A mesma regra está no SQL de normalização (supabase_labels_slug.sql) para os dados antigos.
export const LABEL_NAME_MAX = 100;

export function labelSlug(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
