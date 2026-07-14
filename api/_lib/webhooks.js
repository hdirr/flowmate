import crypto from 'crypto';
import { adminClient } from './db.js';

/**
 * Repassa um evento para o webhook do tenant (n8n, Make, script próprio).
 * Server-side: sem CORS, sem JWT.
 *
 * Contrato do payload (ESTÁVEL — não muda quando retry/fila entrarem):
 *   {
 *     event_id:   uuid,        // único por evento. O consumidor deduplica por ele.
 *     event:      string,
 *     data:       object,
 *     company_id: uuid,
 *     timestamp:  unix ms
 *   }
 *
 * event_id já vai desde agora, mesmo sem retry: quando o retry entrar, o mesmo
 * event_id é reenviado e o n8n descarta a duplicata. Sem isso, retry vira
 * agendamento duplicado. Campo sobrando hoje, contrato estável amanhã.
 *
 * Headers de autenticidade (HMAC-SHA256):
 *   X-Flowmate-Event-Id
 *   X-Flowmate-Timestamp: <unix seconds>
 *   X-Flowmate-Signature: sha256=<hex>
 *
 * A assinatura cobre `${timestamp}.${rawBody}` — o timestamp entra no que é assinado
 * pra que um POST capturado não possa ser reenviado depois (replay).
 */
export async function dispatchWebhook(companyId, event, data) {
  if (!companyId || !event) return { skipped: true };

  const admin = adminClient();
  const { data: integ } = await admin
    .from('company_integrations')
    .select('webhook_url, webhook_events, webhook_secret, enabled')
    .eq('company_id', companyId)
    .single();

  if (!integ?.enabled || !integ.webhook_url) return { skipped: true };

  // Lista vazia = todos os eventos
  if (integ.webhook_events?.length && !integ.webhook_events.includes(event)) {
    return { skipped: true };
  }

  const eventId = crypto.randomUUID();
  const payload = {
    event_id: eventId,
    event,
    data,
    company_id: companyId,
    timestamp: Date.now(),
  };

  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ TRAVA DE ASSINATURA — NÃO REORGANIZE ISTO.                               │
  // │                                                                          │
  // │ Serializamos UMA vez, para os MESMOS bytes (UTF-8), e usamos essa mesma  │
  // │ string em DOIS lugares: no HMAC e no body do fetch.                      │
  // │                                                                          │
  // │ É PROIBIDO reserializar. Se alguém "otimizar" para                       │
  // │   body: JSON.stringify(payload)                                          │
  // │ o corpo enviado pode divergir por 1 byte (acento, emoji, ordem, espaço)  │
  // │ dos bytes assinados, e TODA assinatura passa a falhar no consumidor —    │
  // │ sem erro aqui, quebrando só em produção com acento/emoji. Uma serialização,│
  // │ um buffer, assina e manda ESSE buffer. Ponto.                            │
  // └─────────────────────────────────────────────────────────────────────────┘
  const bodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const tsSeconds = Math.floor(Date.now() / 1000);

  const headers = {
    'Content-Type': 'application/json',
    'X-Flowmate-Event-Id': eventId,
    'X-Flowmate-Timestamp': String(tsSeconds),
  };

  if (integ.webhook_secret) {
    const signature = crypto
      .createHmac('sha256', integ.webhook_secret)
      .update(Buffer.concat([Buffer.from(`${tsSeconds}.`, 'utf8'), bodyBuffer])) // assina os MESMOS bytes que vão no body
      .digest('hex');
    headers['X-Flowmate-Signature'] = `sha256=${signature}`;
  }

  await fetch(integ.webhook_url, {
    method: 'POST',
    headers,
    body: bodyBuffer, // <- exatamente o buffer assinado acima
  }).catch(() => {});

  return { ok: true, event_id: eventId };
}
