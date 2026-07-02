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

  // Tenta criar instância (ignora erro se já existe)
  await fetch(`${EVOLUTION_URL}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      webhook: { url: webhookUrl, enabled: true, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] },
    }),
  }).catch(() => {});

  // Garante webhook configurado na instância existente
  await fetch(`${EVOLUTION_URL}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({ url: webhookUrl, enabled: true, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] }),
  }).catch(() => {});

  // Verifica estado de conexão atual
  const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instanceName}`, {
    headers: { 'apikey': EVOLUTION_KEY },
  }).catch(() => null);

  if (stateRes?.ok) {
    const stateData = await stateRes.json();
    const state = stateData?.instance?.state || stateData?.state;
    if (state === 'open') {
      // Já conectado — atualiza banco e retorna status
      await admin.from('whatsapp_instances').upsert({
        company_id: profile.company_id,
        instance_name: instanceName,
        status: 'connected',
      }, { onConflict: 'company_id' });
      return res.status(200).json({ connected: true, instanceName });
    }
  }

  // Salva instância como desconectada
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
  const qr = qrData?.base64 || qrData?.code || qrData?.qrcode?.base64 || qrData?.qrcode?.code;

  if (!qr) {
    return res.status(400).json({ error: `Sem QR na resposta da API: ${JSON.stringify(qrData)}` });
  }

  return res.status(200).json({ qr, instanceName });
}
