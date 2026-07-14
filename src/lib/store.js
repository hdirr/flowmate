import { supabase } from './supabase';
import { auth } from './auth';

function dispatch() {
  window.dispatchEvent(new Event('flowmate:update'));
}

// Retorna company_id do usuário logado
function cid() { return auth.currentCompanyId(); }
function uid() { return auth.currentUserId(); }

// Dispara um evento para o webhook de integração da empresa (via servidor, sem CORS)
async function emitIntegration(event, data) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    fetch('/api/integrations/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ event, data }),
    }).catch(() => {});
  } catch { /* silencioso */ }
}

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

      if (action.type === 'send_whatsapp' && (action.body || action.mediaUrl) && payload.contact_id) {
        const { data: contact } = await supabase.from('crm_contacts').select('phone, name').eq('id', payload.contact_id).single();
        let phone = (contact?.phone || '').replace(/\D/g, '');
        if (phone) {
          // Formato internacional (adiciona 55 se faltar)
          if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) phone = '55' + phone;
          const msg = (action.body || '').replace(/\{nome\}/gi, contact?.name || '');
          // Envia de verdade pela Evolution API (mesmo caminho do Chat)
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            // Bot = automação. Se o humano assumiu a conversa, o envio leva 409 e não entrega.
            if (action.mediaUrl) {
              await fetch('/api/whatsapp/send-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ to: phone, mediaUrl: action.mediaUrl, mediaType: action.mediaType, mimeType: action.mimeType, fileName: action.fileName, caption: msg || undefined, sender: 'automation' }),
              }).catch(() => {});
            } else {
              await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ to: phone, message: msg, sender: 'automation' }),
              }).catch(() => {});
            }
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

      if (action.type === 'alert_overdue' && payload.contact_id) {
        await supabase.from('crm_notes').insert({
          company_id: cid(), contact_id: payload.contact_id,
          text: '⚠️ ' + (action.body || 'Alerta: lead precisa de atenção'), auto: true,
        });
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

  // Integrações (webhook de saída + API de entrada)
  integrations: {
    get: async () => {
      const { data } = await supabase.from('company_integrations').select('*').eq('company_id', cid()).single();
      return data || null;
    },
    save: async ({ webhook_url, webhook_events, enabled }) => {
      const upd = { company_id: cid() };
      if (webhook_url !== undefined) upd.webhook_url = webhook_url;
      if (webhook_events !== undefined) upd.webhook_events = webhook_events;
      if (enabled !== undefined) upd.enabled = enabled;
      await supabase.from('company_integrations').upsert(upd, { onConflict: 'company_id' });
    },
    regenerateKey: async () => {
      const key = crypto.randomUUID().replace(/-/g, '');
      await supabase.from('company_integrations').upsert({ company_id: cid(), api_key: key }, { onConflict: 'company_id' });
      return key;
    },
  },

  // Funis (multi-pipeline)
  pipelines: {
    list: async () => {
      const { data } = await supabase.from('crm_pipelines')
        .select('*')
        .eq('company_id', cid())
        .order('position');
      return data || [];
    },
    create: async ({ name, allowedUsers }) => {
      const { data: pipe } = await supabase.from('crm_pipelines')
        .insert({ name, company_id: cid(), created_by: uid(), allowed_users: allowedUsers || [], position: 0 })
        .select().single();
      // Cria etapas padrão para o novo funil
      if (pipe) {
        const defaults = [
          { name: 'Novo', color: '#6366f1', position: 1 },
          { name: 'Em contato', color: '#3b82f6', position: 2 },
          { name: 'Fechado', color: '#10b981', position: 3 },
        ];
        for (const s of defaults) {
          await supabase.from('crm_stages').insert({ ...s, company_id: cid(), pipeline_id: pipe.id });
        }
      }
      return pipe;
    },
    update: async (id, { name, allowedUsers }) => {
      const upd = {};
      if (name !== undefined) upd.name = name;
      if (allowedUsers !== undefined) upd.allowed_users = allowedUsers;
      await supabase.from('crm_pipelines').update(upd).eq('id', id).eq('company_id', cid());
    },
    remove: async (id) => {
      // Remove leads e etapas do funil antes de excluí-lo
      await supabase.from('crm_leads').delete().eq('pipeline_id', id).eq('company_id', cid());
      await supabase.from('crm_stages').delete().eq('pipeline_id', id).eq('company_id', cid());
      await supabase.from('crm_pipelines').delete().eq('id', id).eq('company_id', cid());
    },
  },

  stages: {
    list: async (pipelineId) => {
      let q = supabase.from('crm_stages').select('*').eq('company_id', cid());
      if (pipelineId) q = q.eq('pipeline_id', pipelineId);
      const { data } = await q.order('position');
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
      if (row) {
        runAutomations('contact_created', { contact_id: row.id });
        emitIntegration('contact.created', { contact_id: row.id, name: row.name, phone: row.phone, email: row.email });
      }
      return row;
    },
    update: async (id, data) => {
      // Detecta tags recém-adicionadas para disparar o gatilho tag_added
      let newTags = [];
      if (data.tags) {
        const { data: before } = await supabase.from('crm_contacts').select('tags').eq('id', id).single();
        const prev = before?.tags || [];
        newTags = data.tags.filter(t => !prev.includes(t));
      }
      await supabase.from('crm_contacts').update(data).eq('id', id).eq('company_id', cid());
      for (const tag of newTags) {
        runAutomations('tag_added', { contact_id: id, tag });
      }
    },
    remove: async (id) => {
      await supabase.from('crm_contacts').delete().eq('id', id).eq('company_id', cid());
    },
  },

  leads: {
    list: async (pipelineId) => {
      let q = supabase.from('crm_leads')
        .select('*, contact:crm_contacts(*)')
        .eq('company_id', cid());
      if (pipelineId) q = q.eq('pipeline_id', pipelineId);
      const { data } = await q.order('created_at', { ascending: false });
      return data || [];
    },
    create: async (data) => {
      // Deriva o pipeline_id da etapa, se não vier explícito
      let pipeline_id = data.pipeline_id;
      if (!pipeline_id && data.stage_id) {
        const { data: st } = await supabase.from('crm_stages').select('pipeline_id').eq('id', data.stage_id).single();
        pipeline_id = st?.pipeline_id || null;
      }
      const { data: row } = await supabase.from('crm_leads')
        .insert({ ...data, pipeline_id, company_id: cid(), created_by: uid() })
        .select().single();
      if (row) {
        runAutomations('lead_entered_stage', { lead_id: row.id, stage_id: row.stage_id, contact_id: row.contact_id });
        emitIntegration('lead.created', { lead_id: row.id, stage_id: row.stage_id, pipeline_id: row.pipeline_id, contact_id: row.contact_id });
      }
      return row;
    },
    update: async (id, data) => {
      const { data: before } = await supabase.from('crm_leads').select('stage_id, contact_id, pipeline_id').eq('id', id).single();
      const patch = { ...data };
      // Ao mudar de etapa, o pipeline_id acompanha o funil da etapa destino
      // (permite transição de leads entre funis da mesma empresa)
      if (data.stage_id && data.pipeline_id === undefined) {
        const { data: st } = await supabase.from('crm_stages').select('pipeline_id').eq('id', data.stage_id).single();
        if (st?.pipeline_id) patch.pipeline_id = st.pipeline_id;
      }
      await supabase.from('crm_leads').update(patch).eq('id', id).eq('company_id', cid());
      if (data.stage_id && before?.stage_id !== data.stage_id) {
        runAutomations('lead_moved_stage', { lead_id: id, stage_id: data.stage_id, contact_id: before?.contact_id });
        emitIntegration('lead.moved', { lead_id: id, stage_id: data.stage_id, pipeline_id: patch.pipeline_id, contact_id: before?.contact_id });
      }
    },
    remove: async (id) => {
      // Captura o contato antes de excluir para disparar o gatilho lead_lost
      const { data: before } = await supabase.from('crm_leads').select('contact_id').eq('id', id).single();
      await supabase.from('crm_leads').delete().eq('id', id).eq('company_id', cid());
      if (before?.contact_id) {
        runAutomations('lead_lost', { lead_id: id, contact_id: before.contact_id });
      }
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
