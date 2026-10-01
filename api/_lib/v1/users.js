import { adminClient } from '../db.js';
import { fail, readPaging, paged, isRangeBeyondEnd } from './http.js';

// GET /v1/users — usuários da empresa (objeto Usuário do contrato), para descobrir ids.
// Só user_profiles: nada de auth.users. email nulo sai null (não é buscado em outro lugar).
export async function listUsers(req, res, { companyId }) {
  const admin = adminClient();
  const page = readPaging(req.query);

  try {
    const { data, count, error } = await admin.from('user_profiles')
      .select('id, name, email, role, active', { count: 'exact' })
      .eq('company_id', companyId)
      .order('name', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(page.from, page.to);

    if (isRangeBeyondEnd(error)) {
      const { count: total, error: cErr } = await admin.from('user_profiles')
        .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
      if (cErr) throw cErr;
      return paged(res, page, [], total);
    }
    if (error) throw error;

    const items = (data || []).map(u => ({
      id: u.id, name: u.name, email: u.email ?? null, role: u.role, active: u.active,
    }));
    return paged(res, page, items, count);
  } catch (e) {
    console.error('[v1] users falhou:', e?.message || e);
    return fail(res, 500, 'internal_error', 'Erro ao consultar os usuários.');
  }
}
