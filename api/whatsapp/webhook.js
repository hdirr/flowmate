import { createClient } from '@supabase/supabase-js';

const admin = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verificação por segredo compartilhado (ativa quando WEBHOOK_SECRET está configurado)
  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.query?.secret || req.headers['x-webhook-secret'];
    if (provided !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const body = req.body;
    const event = body?.event;
    const instanceName = body?.instance;
    const db = admin();

    // O nome da instância É flowmate-{company_id} — extrai o company_id direto,
    // sem depender da tabela whatsapp_instances (que pode não ter a linha).
    const companyId = instanceName?.startsWith('flowmate-')
      ? instanceName.slice('flowmate-'.length)
      : null;

    if (event === 'connection.update') {
      const state = body?.data?.state;
      const phone = body?.data?.wuid?.replace('@s.whatsapp.net', '') || null;
      if (companyId) {
        await db.from('whatsapp_instances')
          .upsert({
            company_id: companyId,
            instance_name: instanceName,
            status: state === 'open' ? 'connected' : 'disconnected',
            phone,
          }, { onConflict: 'company_id' });
      }
      return res.status(200).json({ ok: true });
    }

    if (event === 'messages.upsert') {
      // Evolution API v2 envia mensagem única em data, não em array
      const msgData = body?.data;
      if (!msgData) return res.status(200).json({ ok: true });
      if (!companyId) return res.status(200).json({ ok: true });

      // Suporta tanto objeto único quanto array
      const messages = Array.isArray(msgData) ? msgData : [msgData];

      for (const msg of messages) {
        const key = msg.key || {};
        const remoteJid = key.remoteJidAlt || key.remoteJid || msg.remoteJid || '';
        if (!remoteJid || remoteJid.includes('@g.us')) continue;

        const fromMe = key.fromMe ?? msg.fromMe ?? false;

        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.title ||
          msg.text ||
          '[mídia]';

        const contactName = msg.pushName || remoteJid.replace('@s.whatsapp.net', '');
        const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);
        const messageId = key.id || msg.id;

        // Evita duplicatas pelo messageId
        if (messageId) {
          const { data: existing } = await db
            .from('whatsapp_messages')
            .select('id')
            .eq('message_id', messageId)
            .single();
          if (existing) continue;
        }

        await db.from('whatsapp_messages').insert({
          company_id: companyId,
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

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
