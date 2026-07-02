import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
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
    .from('user_profiles').select('role, company_id').eq('id', user.id).single();
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  const instanceName = `flowmate-${profile.company_id}`;

  const { count: total } = await admin
    .from('whatsapp_messages').select('*', { count: 'exact', head: true })
    .eq('instance_name', instanceName);

  const { count: received } = await admin
    .from('whatsapp_messages').select('*', { count: 'exact', head: true })
    .eq('instance_name', instanceName).eq('from_me', false);

  const { count: sent } = await admin
    .from('whatsapp_messages').select('*', { count: 'exact', head: true })
    .eq('instance_name', instanceName).eq('from_me', true);

  const { data: lastReceived } = await admin
    .from('whatsapp_messages')
    .select('contact_name, content, remote_jid, message_id, timestamp')
    .eq('instance_name', instanceName).eq('from_me', false)
    .order('timestamp', { ascending: false }).limit(5);

  const { data: contacts } = await admin
    .from('crm_contacts').select('name, phone').eq('company_id', profile.company_id).limit(20);

  // Verifica se a instância existe na tabela (o webhook depende disso)
  const { data: instanceRow } = await admin
    .from('whatsapp_instances').select('*').eq('instance_name', instanceName).single();

  // Tenta a MESMA inserção que o webhook faz e captura o erro real
  const testInsert = await admin.from('whatsapp_messages').insert({
    company_id: profile.company_id,
    instance_name: instanceName,
    remote_jid: '000000000000@s.whatsapp.net',
    from_me: false,
    message_type: 'text',
    content: 'TESTE_DEBUG',
    timestamp: Math.floor(Date.now() / 1000),
    contact_name: 'Teste Debug',
    status: 'received',
    message_id: 'DEBUG_' + Date.now(),
  });

  return res.status(200).json({
    instanceName,
    counts: { total, received, sent },
    lastReceived,
    crmContacts: contacts,
    instanceRowExists: !!instanceRow,
    instanceRow,
    testInsertError: testInsert.error ? testInsert.error.message : null,
  });
}
