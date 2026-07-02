import { createClient } from '@supabase/supabase-js';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  const instanceName = `flowmate-${profile.company_id}`;

  // Busca lista de chats
  const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findChats/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({}),
  });

  if (!chatsRes.ok) {
    const err = await chatsRes.text();
    return res.status(400).json({ error: `Erro ao buscar chats: ${err}` });
  }

  const chatList = await chatsRes.json();
  const chats = Array.isArray(chatList) ? chatList : [];

  // Filtra apenas individuais (não grupos)
  const individualChats = chats
    .filter(c => {
      const jid = c.remoteJid || c.id || '';
      return jid.includes('@s.whatsapp.net');
    })
    .slice(0, 50);

  let imported = 0;

  for (const chat of individualChats) {
    const jid = chat.remoteJid || chat.id;
    const contactName = chat.pushName || chat.name || jid.replace('@s.whatsapp.net', '');

    // Busca últimas mensagens do chat
    const msgsRes = await fetch(`${EVOLUTION_URL}/chat/findMessages/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 20 }),
    });

    if (!msgsRes.ok) continue;

    const msgsData = await msgsRes.json();
    const records = msgsData?.messages?.records || msgsData?.records || [];

    for (const msg of records) {
      const key = msg.key || {};
      const remoteJid = key.remoteJid || jid;
      const fromMe = key.fromMe ?? false;
      const messageId = key.id || msg.id;

      const content =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        null;

      if (!content) continue;

      const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);
      const name = msg.pushName || contactName;

      await admin.from('whatsapp_messages').upsert({
        company_id: profile.company_id,
        instance_name: instanceName,
        remote_jid: remoteJid,
        from_me: fromMe,
        message_type: 'text',
        content,
        timestamp,
        contact_name: name,
        status: fromMe ? 'sent' : 'received',
        message_id: messageId,
      }, { onConflict: 'message_id', ignoreDuplicates: true });

      imported++;
    }
  }

  return res.status(200).json({ ok: true, chats: individualChats.length, imported });
}
