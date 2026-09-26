import { createClient } from '@supabase/supabase-js';
import { resolveUser, adminClient, instanceNameFor, toWhatsAppNumber, jidFor } from '../_lib/db.js';
import { sendMessage } from '../_lib/sendMessage.js';
import { getOrCreateConversation, setConversationState, isKnownOutgoing, STATE } from '../_lib/conversations.js';
import { dispatchWebhook } from '../_lib/webhooks.js';

// Catch-all do WhatsApp. Consolida connect/send/send-media/status/sync/webhook
// (mantém as URLs antigas) e adiciona os endpoints de GRUPOS:
//   GET  /api/whatsapp/groups          → lista grupos da empresa
//   POST /api/whatsapp/groups          → cria grupo na Evolution a partir de contatos do CRM
//
// O Vercel Hobby limita a 12 serverless functions; este catch-all existe para
// não precisar de arquivo novo a cada rota. NÃO criar api/whatsapp/*.js solto.

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

// Chamada à Evolution com log para diagnóstico. Em sucesso loga só o status;
// em falha loga o corpo (sanitizado de segredos) — erro da Evolution vira
// causa visível nos logs do Vercel em vez de black box.
async function evo(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${EVOLUTION_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, text: 'rede indisponível', json: null };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo não-JSON (ex.: página de erro) */ }
  if (!res.ok) {
    const sanitized = text.replace(/(secret=)[^&\s"']+/gi, '$1***').slice(0, 1200);
    console.error(`[whatsapp] ${method} ${path} falhou (${res.status}): ${sanitized}`);
  }
  return { ok: res.ok, status: res.status, text, json };
}

// ─── connect ────────────────────────────────────────────────────────────────
async function handleConnect(req, res) {
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
  const webhookUrl = process.env.WEBHOOK_SECRET
    ? `${process.env.APP_URL}/api/whatsapp/webhook?secret=${process.env.WEBHOOK_SECRET}`
    : `${process.env.APP_URL}/api/whatsapp/webhook`;

  // Garante instância: cria se faltar (erro tolerado — pode já existir) e
  // (re)configura o webhook. Falhas da Evolution agora ficam nos logs.
  async function ensureInstance() {
    await evo('/instance/create', {
      method: 'POST',
      body: {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        webhook: { url: webhookUrl, enabled: true, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] },
      },
    });
    await evo(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: { url: webhookUrl, enabled: true, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] },
    });
  }
  await ensureInstance();

  // Verifica estado de conexão atual
  const stateRes = await evo(`/instance/connectionState/${instanceName}`);
  const state = stateRes.json?.instance?.state || stateRes.json?.state;
  if (stateRes.ok && state === 'open') {
    // Já conectado — atualiza banco e retorna status
    await admin.from('whatsapp_instances').upsert({
      company_id: profile.company_id,
      instance_name: instanceName,
      status: 'connected',
    }, { onConflict: 'company_id' });
    return res.status(200).json({ connected: true, instanceName });
  }

  // Salva instância como desconectada
  await admin.from('whatsapp_instances').upsert({
    company_id: profile.company_id,
    instance_name: instanceName,
    status: 'disconnected',
  }, { onConflict: 'company_id' });

  // Pega QR code, com auto-recuperação: se a instância não existe (estado
  // corrompido/removida) o connect responde 404/erro — recria e tenta de novo.
  async function fetchQr() {
    const r = await evo(`/instance/connect/${instanceName}`);
    const d = r.json || {};
    const rawQr = d?.base64 ?? d?.code ?? d?.qrcode?.base64 ?? d?.qrcode?.code;
    // Garante string: se a Evolution mudar o formato (ex.: objeto em vez de
    // string), o front quebra ao chamar .startsWith — melhor cair no erro
    // 400 abaixo (com o corpo cru pra debug) do que derrubar a página.
    const qr = typeof rawQr === 'string' ? rawQr : null;
    if (qr) return { qr, recoverable: false, raw: '' };
    if (!r.ok) {
      const recoverable = r.status === 404 || /not found|n[aã]o exist|n[aã]o encontrada|inexistente/i.test(r.text);
      return { qr: null, recoverable, raw: `(${r.status}) ${r.text}` };
    }
    return { qr: null, recoverable: false, raw: `(200) ${r.text}` };
  }

  let attempt = await fetchQr();
  if (!attempt.qr && attempt.recoverable) {
    console.warn('[whatsapp] instância não encontrada no connect — recriando e tentando de novo');
    await ensureInstance();
    attempt = await fetchQr();
  }

  if (!attempt.qr) {
    return res.status(400).json({ error: `Sem QR na resposta da API: ${attempt.raw || 'resposta vazia'}` });
  }

  return res.status(200).json({ qr: attempt.qr, instanceName });
}

// ─── send ───────────────────────────────────────────────────────────────────
async function handleSend(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { to, message, sender = 'human' } = req.body || {};

  const result = await sendMessage({
    companyId: who.companyId,
    to,
    content: message,
    sender,
    actorUserId: sender === 'human' ? who.userId : null,
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(200).json(result);
}

// ─── send-media ─────────────────────────────────────────────────────────────
async function handleSendMedia(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const { to, mediaUrl, mediaType, mimeType, fileName, caption, sender = 'human' } = req.body || {};
  if (!mediaUrl || !mediaType) return res.status(400).json({ error: 'Parâmetros incompletos' });

  const result = await sendMessage({
    companyId: who.companyId,
    to,
    content: caption || '',
    sender,
    actorUserId: sender === 'human' ? who.userId : null,
    media: { url: mediaUrl, type: mediaType, mimeType, fileName },
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(200).json(result);
}

// ─── status ─────────────────────────────────────────────────────────────────
async function handleStatus(req, res) {
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

  // Cache quente: usa updated_at da tabela (mantido pelo trigger). Se a coluna
  // ainda não existir (migração não rodada), cai no caminho Evolution abaixo.
  let status = 'disconnected';
  let phone = null;
  let cacheAge = Infinity;

  try {
    const { data: inst } = await admin
      .from('whatsapp_instances')
      .select('status, phone, updated_at')
      .eq('company_id', profile.company_id)
      .single();
    status = inst?.status || 'disconnected';
    phone = inst?.phone || null;
    if (inst?.updated_at) cacheAge = Date.now() - new Date(inst.updated_at).getTime();
  } catch {
    // coluna updated_at ainda não existe — sem cache
  }

  // Cache quente (<45s): responde na hora sem bater na Evolution — abrir a aba
  // Chats não fica mais na mão do Railway (que pode estar frio/sonolento).
  if (cacheAge < 45_000) {
    return res.status(200).json({ status, phone, instanceName });
  }

  // Cache frio: consulta a Evolution (que atualiza o banco via webhook também).
  const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instanceName}`, {
    headers: { 'apikey': EVOLUTION_KEY },
  }).catch(() => null);

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

  phone = instance?.phone || phone;

  // Atualiza status no banco
  await admin.from('whatsapp_instances').upsert({
    company_id: profile.company_id,
    instance_name: instanceName,
    status,
    phone,
  }, { onConflict: 'company_id' });

  return res.status(200).json({ status, phone, instanceName });
}

// ─── sync ───────────────────────────────────────────────────────────────────
async function handleSync(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const t0 = Date.now();
  console.time('[synctrace] auth');

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
    .select('role, company_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

  console.timeEnd('[synctrace] auth');

  const instanceName = `flowmate-${profile.company_id}`;

  console.time('[synctrace] findChats');
  const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findChats/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({}),
  });
  console.timeEnd('[synctrace] findChats');
  console.time('[synctrace] findGroups');

  if (!chatsRes.ok) {
    return res.status(400).json({ error: 'Erro ao buscar chats' });
  }

  const chatList = await chatsRes.json();
  const chats = Array.isArray(chatList) ? chatList : [];

  // 1:1 — inclui @s.whatsapp.net E @lid (novo formato WhatsApp); exclui grupos
  const individualChats = chats
    .filter(c => {
      const jid = c.remoteJid || '';
      return (jid.includes('@s.whatsapp.net') || jid.includes('@lid')) && !jid.includes('@g.us');
    })
    .slice(0, 60);

  // Grupos — descobridos separadamente para registrar em whatsapp_groups
  const groupRows = new Map();
  let groupsSynced = 0;

  const discoveryRes = await fetch(`${EVOLUTION_URL}/group/findGroups/${instanceName}`, {
    method: 'GET',
    headers: { 'apikey': EVOLUTION_KEY },
  }).catch(() => null);
  console.timeEnd('[synctrace] findGroups');

  if (discoveryRes?.ok) {
    const groupsData = await discoveryRes.json();
    const groupList = Array.isArray(groupsData) ? groupsData : groupsData?.groups || [];
    for (const g of groupList) {
      const jid = g?.id || g?.jid || g?.remoteJid;
      const name = g?.subject || g?.name || g?.groupName || jid;
      if (!jid || !String(jid).includes('@g.us')) continue;
      groupRows.set(jid, {
        company_id: profile.company_id,
        instance_name: instanceName,
        jid,
        name,
        description: g?.description || null,
      });
      groupsSynced++;
    }
  }

  // Chats de grupo (histórico)
  const groupChats = chats
    .filter(c => {
      const jid = c.remoteJid || '';
      return jid.includes('@g.us');
    })
    .slice(0, 30);

  // Garante o grupo cadastrado mesmo que findGroups não o tenha retornado
  for (const chat of groupChats) {
    if (!groupRows.has(chat.remoteJid)) {
      groupRows.set(chat.remoteJid, {
        company_id: profile.company_id,
        instance_name: instanceName,
        jid: chat.remoteJid,
        name: chat.name || chat.pushName || chat.remoteJid,
      });
    }
  }

  if (groupRows.size) {
    const groupList = [...groupRows.values()];
    for (let i = 0; i < groupList.length; i += 500) {
      await admin.from('whatsapp_groups').upsert(groupList.slice(i, i + 500), { onConflict: 'company_id,jid' });
    }
  }

  // Busca as mensagens dos chats em PARALELO (concorrência limitada) em vez de
  // um-a-um — 90 chamadas sequenciais à Evolution viravam uma eternidade.
  const CONCURRENCY = 8;
  const MESSAGE_LIMIT = 30;

  function buildRow({ chat, msg, isGroup }) {
    const key = msg.key || {};
    const fromMe = key.fromMe ?? false;
    const messageId = key.id || msg.id;

    const content =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.fileName ||
      null;

    if (!content) return null;

    // Usa remoteJidAlt (número real) se disponível, senão usa o jid original
    const displayJid = key.remoteJidAlt || chat.remoteJid;
    const participantJid = isGroup ? (key.participant || null) : null;
    const contactName = isGroup
      ? (msg.pushName || (participantJid ? participantJid.replace(/@.*/, '') : chat.name || displayJid.replace(/@.*/, '')))
      : (msg.pushName || chat.pushName || chat.name || displayJid.replace(/@.*/, ''));
    const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

    return {
      company_id: profile.company_id,
      instance_name: instanceName,
      remote_jid: displayJid,
      participant_jid: participantJid,
      from_me: fromMe,
      message_type: 'text',
      content,
      timestamp,
      contact_name: contactName,
      status: fromMe ? 'sent' : 'received',
      message_id: messageId,
    };
  }

  async function fetchChatMessages(chats, isGroup) {
    const rows = [];
    const queue = [...chats];

    async function worker() {
      while (queue.length) {
        const chat = queue.shift();
        const msgsRes = await evo(`/chat/findMessages/${instanceName}`, {
          method: 'POST',
          body: { where: { key: { remoteJid: chat.remoteJid } }, limit: MESSAGE_LIMIT },
        });
        if (!msgsRes.ok || !msgsRes.json) continue;
        const records = msgsRes.json?.messages?.records || [];
        for (const msg of records) {
          const row = buildRow({ chat, msg, isGroup });
          if (row) rows.push(row);
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
    await Promise.all(workers);
    return rows;
  }

  console.time('[synctrace] findMessages');
  const [individualRows, groupRowsFromChats] = await Promise.all([
    fetchChatMessages(individualChats, false),
    fetchChatMessages(groupChats, true),
  ]);
  console.timeEnd('[synctrace] findMessages');

  const allRows = [...individualRows, ...groupRowsFromChats];

  // Upsert em LOTE (dedup por message_id), com chunks de 500 para respeitar o
  // limite de linhas por request do PostgREST.
  console.time('[synctrace] upserts');
  for (let i = 0; i < allRows.length; i += 500) {
    await admin.from('whatsapp_messages').upsert(allRows.slice(i, i + 500), {
      onConflict: 'message_id',
      ignoreDuplicates: true,
    });
  }
  console.timeEnd('[synctrace] upserts');
  console.log(`[synctrace] total ${Date.now() - t0}ms (${individualChats.length} chats, ${allRows.length} msgs)`);

  return res.status(200).json({ ok: true, chats: individualChats.length, groups: groupsSynced, imported: allRows.length });
}

// ─── webhook ────────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.query?.secret || req.headers['x-webhook-secret'];
    if (provided !== expectedSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;
    const event = body?.event;
    const instanceName = body?.instance;
    const db = adminClient();

    // O nome da instância É flowmate-{company_id}.
    const companyId = instanceName?.startsWith('flowmate-')
      ? instanceName.slice('flowmate-'.length)
      : null;

    const t0 = Date.now();
    console.log(`[webhook] event=${event} instance=${instanceName} company=${companyId ?? '-'}`);

    if (event === 'connection.update') {
      const state = body?.data?.state;
      const phone = body?.data?.wuid?.replace('@s.whatsapp.net', '') || null;
      if (companyId) {
        await db.from('whatsapp_instances').upsert({
          company_id: companyId,
          instance_name: instanceName,
          status: state === 'open' ? 'connected' : 'disconnected',
          phone,
        }, { onConflict: 'company_id' });
      }
      return res.status(200).json({ ok: true });
    }

    if (event === 'messages.upsert') {
      const msgData = body?.data;
      if (!msgData || !companyId) {
        console.log(`[webhook] messages.upsert sem dados (data=${typeof msgData}, company=${companyId ?? '-'})`);
        return res.status(200).json({ ok: true });
      }

      const messages = Array.isArray(msgData) ? msgData : [msgData];
      console.log(`[webhook] messages.upsert n=${messages.length} (${Date.now() - t0}ms até o parser)`);

      for (const msg of messages) {
        const key = msg.key || {};
        const remoteJid = key.remoteJidAlt || key.remoteJid || msg.remoteJid || '';
        if (!remoteJid) continue;

        const isGroup = remoteJid.includes('@g.us');
        const participantJid = isGroup ? (key.participant || msg.participant || null) : null;

        const fromMe = key.fromMe ?? msg.fromMe ?? false;
        const messageId = key.id || msg.id;

        // Dedup: se já gravamos essa mensagem, ignora.
        const { data: dup } = await db
          .from('whatsapp_messages').select('id').eq('message_id', messageId).limit(1);
        const alreadyLogged = !!(dup && dup.length);

        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.title ||
          msg.text ||
          '[mídia]';

        const contactName = isGroup
          ? (msg.pushName || (participantJid ? participantJid.replace(/@.*/, '') : remoteJid.replace(/@.*/, '')))
          : (msg.pushName || remoteJid.replace(/@.*/, ''));

        const timestamp = msg.messageTimestamp || Math.floor(Date.now() / 1000);

        // 1) Cria ou recupera a conversa (default: automation).
        //    Grupos também ganham linha (conversation_id no log), mas a máquina
        //    de estado automático|humano NÃO se aplica a eles.
        const conversation = await getOrCreateConversation(companyId, remoteJid);

        // 2) 1:1 — fromMe com message_id DESCONHECIDO = o dono respondeu pelo celular.
        //    Esse é o caso que fura a feature se for esquecido: a recepcionista responde
        //    pelo WhatsApp do celular (é o que ela sempre fez) e a automação atropela.
        //    Em GRUPOS isso é ignorado (decisão de produto: grupos não pausam).
        if (!isGroup && fromMe && !alreadyLogged) {
          const known = await isKnownOutgoing(messageId);
          if (!known && conversation.state !== STATE.HUMAN) {
            await setConversationState(conversation.id, STATE.HUMAN, null); // null = veio do celular
            conversation.state = STATE.HUMAN;
          }
        }

        // 3) Grava no log (fonte da verdade)
        if (!alreadyLogged) {
          await db.from('whatsapp_messages').insert({
            company_id: companyId,
            conversation_id: conversation.id,
            instance_name: instanceName,
            remote_jid: remoteJid,
            participant_jid: participantJid,
            from_me: fromMe,
            message_type: 'text',
            content,
            timestamp,
            contact_name: contactName,
            status: fromMe ? 'sent' : 'received',
            message_id: messageId,
          });
        }

        // 4) Repassa pro consumidor SÓ quando a conversa está em automação e é 1:1.
        //    Em 'human', a automação não precisa nem saber que a mensagem existiu.
        //    Em grupos não repassamos (o robô só ENVIA para grupos).
        if (!isGroup && !fromMe && !alreadyLogged && conversation.state === STATE.AUTOMATION) {
          await dispatchWebhook(companyId, 'message.received', {
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            remote_jid: remoteJid,
            from: remoteJid.replace(/@.*/, ''),
            contact_name: contactName,
            content,
            message_id: messageId,
            timestamp,
          });
        }
      }

      console.log(`[webhook] messages.upsert processadas em ${Date.now() - t0}ms`);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── groups ─────────────────────────────────────────────────────────────────
async function handleGroups(req, res) {
  const who = await resolveUser(req.headers.authorization);
  if (!who) return res.status(401).json({ error: 'Unauthorized' });

  const admin = adminClient();

  if (req.method === 'GET') {
    const { data } = await admin
      .from('whatsapp_groups')
      .select('*')
      .eq('company_id', who.companyId)
      .order('updated_at', { ascending: false });
    return res.status(200).json({ groups: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { name, description, participantIds } = req.body || {};
  if (!name || !Array.isArray(participantIds) || participantIds.length === 0) {
    console.error('[whatsapp/groups] validação falhou — payload recebido:', JSON.stringify(req.body));
    return res.status(400).json({ error: 'Nome e participantes são obrigatórios', received: req.body ?? null });
  }

  const instanceName = instanceNameFor(who.companyId);

  // Telefones dos participantes (só contatos do CRM, company-scoped)
  const { data: contacts } = await admin
    .from('crm_contacts')
    .select('id, phone')
    .eq('company_id', who.companyId)
    .in('id', participantIds);

  const phones = (contacts || [])
    .filter(c => c.phone)
    .map(c => toWhatsAppNumber(c.phone));

  if (phones.length === 0) {
    return res.status(400).json({ error: 'Nenhum participante com telefone encontrado' });
  }

  // Cria o grupo DE VERDADE na Evolution (adiciona os participantes no WhatsApp)
  const evoRes = await fetch(`${EVOLUTION_URL}/group/create/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({
      groupName: name,
      description: description || undefined,
      participants: phones,
    }),
  });

  if (!evoRes.ok) {
    const err = await evoRes.json().catch(() => ({}));
    return res.status(502).json({ error: err.message || 'delivery_failed' });
  }

  const evoData = await evoRes.json().catch(() => ({}));
  const groupJid = evoData?.groupJid || evoData?.jid || evoData?.id || evoData?.groupId;

  if (!groupJid) {
    return res.status(502).json({ error: `Sem groupJid na resposta: ${JSON.stringify(evoData)}` });
  }

  const { data: created } = await admin.from('whatsapp_groups')
    .upsert({
      company_id: who.companyId,
      instance_name: instanceName,
      jid: groupJid,
      name: evoData?.groupName || name,
      description: description || null,
      participant_phones: phones,
      created_by: who.userId,
    }, { onConflict: 'company_id,jid' })
    .select().single();

  return res.status(200).json({ ok: true, group: created });
}

// ─── roteador ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // req.query.path às vezes vem vazio (Vercel entrega o segmento como
  // req.query['...path'] fora de alguns contextos) — mesmo fallback usado
  // em api/v1/[...path].js e api/billing/[...path].js: deriva de req.url.
  const segments = req.query?.path;
  let path = Array.isArray(segments) ? segments.join('/') : (segments || '');
  if (!path) {
    path = (req.url || '').split('?')[0].replace(/^\/(api\/)?whatsapp\//, '').replace(/\/+$/, '');
  }

  const routes = {
    'connect': handleConnect,
    'send': handleSend,
    'send-media': handleSendMedia,
    'status': handleStatus,
    'sync': handleSync,
    'webhook': handleWebhook,
    'groups': handleGroups,
    '': handleGroups, // /api/whatsapp → GET lista grupos (fallback amigável)
  };

  const h = routes[path];
  if (!h) return res.status(404).json({ error: 'route_not_found' });
  return h(req, res);
}