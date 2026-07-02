import { createClient } from '@supabase/supabase-js';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

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
    .select('company_id')
    .eq('id', user.id)
    .single();

  if (!profile?.company_id) return res.status(200).json({ status: 'disconnected' });

  const instanceName = `flowmate-${profile.company_id}`;

  // Verifica diretamente na Evolution API
  const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instanceName}`, {
    headers: { 'apikey': EVOLUTION_KEY },
  }).catch(() => null);

  let status = 'disconnected';
  let phone = null;

  if (stateRes?.ok) {
    const stateData = await stateRes.json();
    const state = stateData?.instance?.state || stateData?.state;
    if (state === 'open') {
      status = 'connected';
    }
  }

  // Busca phone do banco
  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('phone')
    .eq('company_id', profile.company_id)
    .single();

  phone = instance?.phone || null;

  // Atualiza status no banco
  await admin.from('whatsapp_instances').upsert({
    company_id: profile.company_id,
    instance_name: instanceName,
    status,
    phone,
  }, { onConflict: 'company_id' });

  return res.status(200).json({ status, phone, instanceName });
}
