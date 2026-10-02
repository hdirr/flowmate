// Telefone → número/JID do WhatsApp. FONTE ÚNICA da regra (P1-E0): usada pelo servidor
// (db.js reexporta; sendMessage, /v1, grupos, estado da conversa) e pelo front (Chats.jsx).
// Este arquivo é importado também pelo front: mantenha-o sem dependências de Node.

// Normaliza para o formato internacional usado pelo WhatsApp (só dígitos):
// - começa com "+": já tem o código do país → só os dígitos, sem acrescentar nada;
// - 10 dígitos (fixo BR, ou celular antigo sem o 9) → 55 + número;
// - 11 dígitos com 9 na 3ª posição (celular BR: DDD + 9 + 8 dígitos) → 55 + número;
// - qualquer outro caso fica como veio. Inclui 11 dígitos sem 9 na 3ª posição (nunca é
//   celular BR; é o formato dos EUA/Canadá com o 1) e 12–13 dígitos (já com o 55).
// Ambíguo, tratado como BR: 11 dígitos com 9 na 3ª posição que também sejam número válido de
// outro país (ex.: Rússia 7 9xx…). Para esses, mande com "+".
export function toWhatsAppNumber(input) {
  const raw = String(input ?? '').trim();
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d;
  if (d.length === 10) return '55' + d;
  if (d.length === 11 && d[2] === '9') return '55' + d;
  return d;
}

export function jidFor(number) {
  return `${toWhatsAppNumber(number)}@s.whatsapp.net`;
}

// Conversa "gêmea" de celular BR: o WhatsApp grava muitos JIDs sem o 9º dígito
// (55 + DDD + 8 dígitos) e o FlowMate monta com ele (55 + DDD + 9 + 8). Devolve o JID no
// outro formato, ou null quando não há gêmea (grupo, @lid, fixo, estrangeiro).
export function twinJid(jid) {
  const m = /^(\d+)@s\.whatsapp\.net$/.exec(String(jid || ''));
  if (!m) return null;
  const d = m[1];
  if (!d.startsWith('55')) return null;
  if (d.length === 13 && d[4] === '9') return `${d.slice(0, 4)}${d.slice(5)}@s.whatsapp.net`;
  if (d.length === 12 && /[6-9]/.test(d[4])) return `${d.slice(0, 4)}9${d.slice(4)}@s.whatsapp.net`;
  return null;
}
