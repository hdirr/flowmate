import { createClient } from '@supabase/supabase-js';

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
    .from('user_profiles').select('company_id').eq('id', user.id).single();
  if (!profile?.company_id) return res.status(200).json({ ok: true });

  const { event, data } = req.body || {};

  const { data: integ } = await admin
    .from('company_integrations')
    .select('webhook_url, webhook_events, enabled')
    .eq('company_id', profile.company_id)
    .single();

  if (!integ?.enabled || !integ.webhook_url) return res.status(200).json({ ok: true, skipped: true });
  // Filtra por eventos selecionados (vazio = todos)
  if (integ.webhook_events?.length && !integ.webhook_events.includes(event)) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  // Dispara pro webhook do cliente (n8n, Zapier, Make, etc.) — server-side, sem CORS
  await fetch(integ.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data, company_id: profile.company_id, timestamp: Date.now() }),
  }).catch(() => {});

  return res.status(200).json({ ok: true });
}
