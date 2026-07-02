import { createClient } from '@supabase/supabase-js';

const admin = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;
    const event = body?.event;
    const instanceName = body?.instance;
    const db = admin();

    // Atualiza status da instância
    if (event === 'connection.update') {
      const state = body?.data?.state;
      const phone = body?.data?.wuid?.replace('@s.whatsapp.net', '') || null;
      await db.from('whatsapp_instances')
        .update({ status: state === 'open' ? 'connected' : 'disconnected', phone })
        .eq('instance_name', instanceName);
      return res.status(200).json({ ok: true });
    }

    // Mensagem recebida
    if (event === 'messages.upsert') {
      const messages = body?.data?.messages || [];
      for (const msg of messages) {
        if (!msg.key) continue;
        const fromMe = msg.key.fromMe || false;
        const remoteJid = msg.key.remoteJid || '';
        if (remoteJid.includes('@g.us')) continue; // ignora grupos

        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '[mídia]';

        const contactName = msg.pushName || remoteJid.replace('@s.whatsapp.net', '');

        // Busca company_id pela instância
        const { data: instance } = await db
          .from('whatsapp_instances')
          .select('company_id')
          .eq('instance_name', instanceName)
          .single();

        if (!instance) continue;

        await db.from('whatsapp_messages').insert({
          company_id: instance.company_id,
          instance_name: instanceName,
          remote_jid: remoteJid,
          from_me: fromMe,
          message_type: 'text',
          content,
          timestamp: msg.messageTimestamp,
          contact_name: contactName,
          status: 'received',
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
