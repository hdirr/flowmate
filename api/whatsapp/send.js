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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single();

  const { to, message, instanceName } = req.body;

  const sendRes = await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({ number: to, text: message }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.json();
    return res.status(400).json({ error: err.message || 'Erro ao enviar mensagem' });
  }

  // Salva mensagem enviada no banco
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await admin.from('whatsapp_messages').insert({
    company_id: profile.company_id,
    instance_name: instanceName,
    remote_jid: `${to}@s.whatsapp.net`,
    from_me: true,
    message_type: 'text',
    content: message,
    timestamp: Math.floor(Date.now() / 1000),
    status: 'sent',
  });

  return res.status(200).json({ ok: true });
}
