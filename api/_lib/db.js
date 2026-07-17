import { createClient } from '@supabase/supabase-js';

// Cliente admin (service_role) — só roda no servidor.
export function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Cliente com o JWT do usuário (para resolver quem chamou).
export function userClient(authHeader) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
}

// Resolve o company_id a partir do JWT do usuário. Retorna { userId, companyId } ou null.
export async function resolveUser(authHeader) {
  if (!authHeader) return null;
  const supabase = userClient(authHeader);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = adminClient();
  const { data: profile } = await admin
    .from('user_profiles').select('company_id').eq('id', user.id).single();
  if (!profile?.company_id) return null;
  return { userId: user.id, companyId: profile.company_id, email: user.email };
}

// Resolve o company_id a partir da API key do tenant. Retorna companyId ou null.
export async function resolveApiKey(apiKey) {
  if (!apiKey) return null;
  const admin = adminClient();
  const { data } = await admin
    .from('company_integrations')
    .select('company_id, enabled')
    .eq('api_key', apiKey)
    .single();
  if (!data || data.enabled === false) return null;
  return data.company_id;
}

export function instanceNameFor(companyId) {
  return `flowmate-${companyId}`;
}

// Normaliza um número para o formato internacional usado pelo WhatsApp.
export function toWhatsAppNumber(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

export function jidFor(number) {
  return `${toWhatsAppNumber(number)}@s.whatsapp.net`;
}
