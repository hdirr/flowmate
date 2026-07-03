import { supabase } from './supabase';
import { auth } from './auth';

function dispatch() {
  window.dispatchEvent(new Event('flowmate:update'));
}

// Retorna company_id do usuário logado
function cid() { return auth.currentCompanyId(); }
function uid() { return auth.currentUserId(); }

// ─── Automações ──────────────────────────────────────────────
async function runAutomations(event, payload) {
  const { data: workflows } = await supabase
    .from('flowmate_workflows')
    .select('*')
    .eq('company_id', cid())
    .eq('enabled', true)
    .eq('trigger_type', event);

  if (!workflows?.length) return;

  let changed = false;

  for (const wf of workflows) {
    const actions = wf.actions || [];

    // Filtro por etapa se configurado
    const triggerConfig = wf.trigger_config || {};
    if ((event === 'lead_entered_stage' || event === 'lead_moved_stage') &&
        triggerConfig.stage_id && triggerConfig.stage_id !== payload.stage_id) continue;

    for (const action of actions) {
      if (action.type === 'move_stage' && action.stageId && payload.lead_id) {
        await supabase.from('crm_leads')
          .update({ stage_id: action.stageId })
          .eq('id', payload.lead_id);
        changed = true;
      }

      if ((action.type === 'add_note' || action.type === 'notify_team') && action.body && payload.contact_id) {
        await supabase.from('crm_notes').insert({
          company_id: cid(), contact_id: payload.contact_id,
          text: action.body, auto: true,
        });
        changed = true;
      }

      if (action.type === 'send_whatsapp' && action.body && payload.contact_id) {
        const { data: contact } = await supabase.from('crm_contacts').select('phone, name').eq('id', payload.contact_id).single();
        let phone = (contact?.phone || '').replace(/\D/g, '');
        if (phone) {
          // Formato internacional (adiciona 55 se faltar)
          if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = '55' + phone;
          const msg = action.body.replace(/\{nome\}/gi, contact?.name || '');
          // Envia de verdade pela Evolution API (mesmo caminho do Chat)
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            await fetch('/api/whatsapp/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ to: phone, message: msg, instanceName: `flowmate-${cid()}` }),
            }).catch(() => {});
          }
        }
      }

      if (action.type === 'add_tag' && action.tag && payload.contact_id) {
        const { data: contact } = await supabase.from('crm_contacts').select('tags').eq('id', payload.contact_id).single();
        const tags = contact?.tags || [];
        if (!tags.includes(action.tag)) {
          await supabase.from('crm_contacts').update({ tags: [...tags, action.tag] }).eq('id', payload.contact_id);
          changed = true;
        }
      }

      if (action.type === 'mark_priority' && payload.lead_id) {
        await supabase.from('crm_leads').update({ priority: true }).eq('id', payload.lead_id);
        changed = true;
      }

      if (action.type === 'set_field' && action.fieldId && payload.contact_id) {
        const { data: contact } = await supabase.from('crm_contacts').select('fields').eq('id', payload.contact_id).single();
        const fields = { ...(contact?.fields || {}), [action.fieldId]: action.fieldValue || '' };
        await supabase.from('crm_contacts').update({ fields }).eq('id', payload.contact_id);
        changed = true;
      }

      if (action.type === 'webhook' && action.body) {
        fetch(action.body, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, ...payload }),
        }).catch(() => {});
      }
    }
  }

  if (changed) dispatch();
}

// ─── db ──────────────────────────────────────────────────────
export const db = {

  stages: {
    list: async () => {
      const { data } = await supabase.from('crm_stages')
        .select('*')
        .eq('company_id', cid())
        .order('position');
      return data || [];
    },
    save: async (stages) => {
      for (const s of stages) {
        await supabase.from('crm_stages').upsert({ ...s, company_id: cid() });
      }
    },
    create: async (data) => {
      const { data: row } = await supabase.from('crm_stages')
        .insert({ ...data, company_id: cid() })
        .select().single();
      return row;
    },
    update: async (id, data) => {
      await supabase.from('crm_stages').update(data).eq('id', id).eq('company_id', cid());
    },
    remove: async (id) => {
      await supabase.from('crm_stages').delete().eq('id', id).eq('company_id', cid());
    },
  },

  contacts: {
    list: async () => {
      const { data } = await supabase.from('crm_contacts')
        .select('*')
        .eq('company_id', cid())
        .order('created_at', { ascending: false });
      return data || [];
    },
    create: async (data) => {
      const { data: row } = await supabase.from('crm_contacts')
        .insert({ ...data, company_id: cid(), created_by: uid() })
        .select().single();
      if (row) runAutomations('contact_created', { contact_id: row.id });
      return row;
    },
    update: async (id, data) => {
      await supabase.from('crm_contacts').update(data).eq('id', id).eq('company_id', cid());
    },
    remove: async (id) => {
      await supabase.from('crm_contacts').delete().eq('id', id).eq('company_id', cid());
    },
  },

  leads: {
    list: async () => {
      const { data } = await supabase.from('crm_leads')
        .select('*, contact:crm_contacts(*)')
        .eq('company_id', cid())
        .order('created_at', { ascending: false });
      return data || [];
    },
    create: async (data) => {
      const { data: row } = await supabase.from('crm_leads')
        .insert({ ...data, company_id: cid(), created_by: uid() })
        .select().single();
      if (row) runAutomations('lead_entered_stage', { lead_id: row.id, stage_id: row.stage_id, contact_id: row.contact_id });
      return row;
    },
    update: async (id, data) => {
      const { data: before } = await supabase.from('crm_leads').select('stage_id, contact_id').eq('id', id).single();
      await supabase.from('crm_leads').update(data).eq('id', id).eq('company_id', cid());
      if (data.stage_id && before?.stage_id !== data.stage_id) {
        runAutomations('lead_moved_stage', { lead_id: id, stage_id: data.stage_id, contact_id: before?.contact_id });
      }
    },
    remove: async (id) => {
      await supabase.from('crm_leads').delete().eq('id', id).eq('company_id', cid());
    },
  },

  notes: {
    list: async (contactId) => {
      const { data } = await supabase.from('crm_notes')
        .select('*')
        .eq('contact_id', contactId)
        .eq('company_id', cid())
        .order('created_at');
      return data || [];
    },
    create: async (contactId, text) => {
      const { data: row } = await supabase.from('crm_notes')
        .insert({ contact_id: contactId, company_id: cid(), user_id: uid(), text })
        .select().single();
      return row;
    },
    remove: async (id) => {
      await supabase.from('crm_notes').delete().eq('id', id).eq('company_id', cid());
    },
  },

  workflows: {
    list: async () => {
      const { data } = await supabase.from('flowmate_workflows')
        .select('*')
        .eq('company_id', cid())
        .order('created_at', { ascending: false });
      return data || [];
    },
    create: async (data) => {
      const { trigger, triggerStageId, triggerDays, actions, name } = data;
      const { data: row } = await supabase.from('flowmate_workflows').insert({
        name,
        company_id: cid(),
        created_by: uid(),
        enabled: true,
        trigger_type: trigger,
        trigger_config: { stage_id: triggerStageId || null, days: triggerDays || null },
        actions: actions || [],
      }).select().single();
      return row;
    },
    update: async (id, data) => {
      const { trigger, triggerStageId, triggerDays, actions, name, enabled } = data;
      const update = {};
      if (name !== undefined)    update.name = name;
      if (enabled !== undefined) update.enabled = enabled;
      if (trigger !== undefined) update.trigger_type = trigger;
      if (actions !== undefined) update.actions = actions;
      if (triggerStageId !== undefined || triggerDays !== undefined) {
        update.trigger_config = { stage_id: triggerStageId || null, days: triggerDays || null };
      }
      await supabase.from('flowmate_workflows').update(update).eq('id', id).eq('company_id', cid());
    },
    remove: async (id) => {
      await supabase.from('flowmate_workflows').delete().eq('id', id).eq('company_id', cid());
    },
  },

  customFields: {
    list: async () => {
      const { data } = await supabase.from('custom_fields')
        .select('*')
        .eq('company_id', cid())
        .order('created_at');
      return data || [];
    },
    create: async (data) => {
      const { data: row } = await supabase.from('custom_fields')
        .insert({ ...data, company_id: cid(), created_by: uid() })
        .select().single();
      return row;
    },
    update: async (id, data) => {
      await supabase.from('custom_fields').update(data).eq('id', id).eq('company_id', cid());
    },
    remove: async (id) => {
      await supabase.from('custom_fields').delete().eq('id', id).eq('company_id', cid());
    },
  },
};
