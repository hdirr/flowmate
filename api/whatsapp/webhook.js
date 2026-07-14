import { adminClient } from '../_lib/db.js';
import { getOrCreateConversation, setConversationState, isKnownOutgoing, STATE } from '../_lib/conversations.js';
import { dispatchWebhook } from '../_lib/webhooks.js';

// Webhook de entrada da Evolution. É a FONTE DA VERDADE do log de conversas.
// Também é o ouvido do n8n: repassa message.received quando a conversa está em automação.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.query?.secret || req.headers['x-webhook-secret'];
    if (provided !== expectedSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;
    const event = body?.event;
    const instanceName = body?.instance;
    const db = adminClient();

    // O nome da instância É flowmate-{company_id}.
    const companyId = instanceName?.startsWith('flowmate-')
      ? instanceName.slice('flowmate-'.length)
      : null;

    if (event === 'connection.update') {
      const state = body?.data?.state;
      const phone = body?.data?.wuid?.replace('@s.whatsapp.net', '') || null;
      if (companyId) {
        await db.from('whatsapp_instances').upsert({
          company_id: companyId,
          instance_name: instanceName,
          status: state === 'open' ? 'connected' : 'disconnected',
          phone,
        }, { onConflict: 'company_id' });
      }
      return res.status(200).json({ ok: true });
    }

    if (event === 'messages.upsert') {
      const msgData = body?.data;
      if (!msgData || !companyId) return res.status(200).json({ ok: true });

      const messages = Array.isArray(msgData) ? msgData : [msgData];

      for (const msg of messages) {
        const key = msg.key || {};
        const remoteJid = key.remoteJidAlt || key.remoteJid || msg.remoteJid || '';
        if (!remoteJid || remoteJid.includes('@g.us')) continue;

        const fromMe = key.fromMe ?? msg.fromMe ?? false;
        const messageId = key.id || msg.id;

        // Dedup: se já gravamos essa mensagem, ignora.
        const { data: dup } = await db
          .from('whatsapp_messages').select('id').eq('message_id', messageId).limit(1);
        const alreadyLogged = !!(dup && dup.length);

        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.title ||
          msg.text ||
          '[mídia]';

        const contactName = msg.pushName || remoteJid.replace(/@.*/, '');
        const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

        // 1) Cria ou recupera a conversa (default: automation)
        const conversation = await getOrCreateConversation(companyId, remoteJid);

        // 2) fromMe com message_id DESCONHECIDO = o dono respondeu pelo celular dele.
        //    Esse é o caso que fura a feature se for esquecido: a recepcionista responde
        //    pelo WhatsApp do celular (é o que ela sempre fez) e a automação atropela.
        if (fromMe && !alreadyLogged) {
          const known = await isKnownOutgoing(messageId);
          if (!known && conversation.state !== STATE.HUMAN) {
            await setConversationState(conversation.id, STATE.HUMAN, null); // null = veio do celular
            conversation.state = STATE.HUMAN;
          }
        }

        // 3) Grava no log (fonte da verdade)
        if (!alreadyLogged) {
          await db.from('whatsapp_messages').insert({
            company_id: companyId,
            conversation_id: conversation.id,
            instance_name: instanceName,
            remote_jid: remoteJid,
            from_me: fromMe,
            message_type: 'text',
            content,
            timestamp,
            contact_name: contactName,
            status: fromMe ? 'sent' : 'received',
            message_id: messageId,
          });
        }

        // 4) Repassa pro tenant SÓ quando a conversa está em automação.
        //    Em 'human', a automação não precisa nem saber que a mensagem existiu.
        if (!fromMe && !alreadyLogged && conversation.state === STATE.AUTOMATION) {
          await dispatchWebhook(companyId, 'message.received', {
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            remote_jid: remoteJid,
            from: remoteJid.replace(/@.*/, ''),
            contact_name: contactName,
            content,
            message_id: messageId,
            timestamp,
          });
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
