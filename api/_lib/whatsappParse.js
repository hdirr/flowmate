// Parser de mensagem da Evolution (texto/mídia). Movido de api/whatsapp/[...path].js
// (sem mudança de lógica) para ser usado também por api/_lib/inbound.js (CF-A).

// O WhatsApp embrulha mensagens efêmeras, "ver uma vez", editadas e documentos
// com legenda em outro objeto; desembrulha antes de olhar o tipo.
export function unwrapMessage(message) {
  let cur = message || {};
  for (let i = 0; i < 4; i++) {
    const inner =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.viewOnceMessageV2Extension?.message ||
      cur.documentWithCaptionMessage?.message ||
      cur.editedMessage?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

const MEDIA_KINDS = [
  ['imageMessage', 'image', '[imagem]'],
  ['videoMessage', 'video', '[vídeo]'],
  ['audioMessage', 'audio', '[áudio]'],
  ['documentMessage', 'document', '[documento]'],
  ['stickerMessage', 'sticker', '[sticker]'],
];

// → { type, content, fileName }. type ∈ text|image|video|audio|document|sticker.
// content é a legenda (ou um marcador tipo "[áudio]" quando não há legenda);
// para texto sem conteúdo devolve null.
export function parseMessage(message) {
  const m = unwrapMessage(message);
  for (const [key, type, placeholder] of MEDIA_KINDS) {
    const x = m[key];
    if (!x) continue;
    const fileName = type === 'document' ? (x.fileName || x.title || null) : null;
    return { type, content: x.caption || placeholder, fileName };
  }
  return { type: 'text', content: m.conversation || m.extendedTextMessage?.text || null, fileName: null };
}
