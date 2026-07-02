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
    .select('role, company_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const instanceName = `flowmate-${profile.company_id}`;
  const webhookUrl = `${process.env.APP_URL}/api/whatsapp/webhook`;

  // Cria instância na Evolution API
  const createRes = await fetch(`${EVOLUTION_URL}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      webhook: { url: webhookUrl, enabled: true, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    // Se já existe, tudo bem — continua
    if (!err.message?.includes('already')) {
      return res.status(400).json({ error: err.message || 'Erro ao criar instância' });
    }
  }

  // Salva/atualiza instância no banco
  await admin.from('whatsapp_instances').upsert({
    company_id: profile.company_id,
    instance_name: instanceName,
    status: 'disconnected',
  }, { onConflict: 'company_id' });

  // Pega QR code
  const qrRes = await fetch(`${EVOLUTION_URL}/instance/connect/${instanceName}`, {
    headers: { 'apikey': EVOLUTION_KEY },
  });
  const qrData = await qrRes.json();

  return res.status(200).json({ qr: qrData?.base64 || qrData?.code, instanceName });
}
