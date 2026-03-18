import type { HostfullyWebhookPayload } from '../skills/hostfully-client/index.ts';
import { createDeduplicator } from '../skills/dedup/index.ts';

const PORT = parseInt(process.env['WEBHOOK_PORT'] ?? '3001', 10);
const OPENCLAW_URL = 'http://127.0.0.1:18789/hooks/hostfully';
const OPENCLAW_TOKEN = process.env['OPENCLAW_HOOKS_TOKEN'] ?? '';

const dedup = createDeduplicator('data/processed-messages.txt');

async function forwardToOpenClaw(payload: HostfullyWebhookPayload): Promise<void> {
  const resp = await fetch(OPENCLAW_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`OpenClaw returned ${resp.status} ${resp.statusText}`);
  }

  console.log(`[WEBHOOK] Forwarded to OpenClaw: ${resp.status}`);
}

export function startWebhookReceiver(): void {
  Bun.serve({
    port: PORT,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'papi-chulo-v2',
            uptime: Math.floor(process.uptime()),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (request.method === 'POST' && url.pathname === '/webhook') {
        let payload: HostfullyWebhookPayload;

        try {
          payload = (await request.json()) as HostfullyWebhookPayload;
        } catch {
          console.error('[WEBHOOK] Failed to parse request body as JSON');
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (!payload.event_type) {
          console.warn('[WEBHOOK] Received payload without event_type — ignoring');
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (payload.event_type !== 'NEW_INBOX_MESSAGE') {
          console.log(`[WEBHOOK] Ignoring event_type: ${payload.event_type}`);
          return new Response(JSON.stringify({ ok: true, ignored: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        console.log(`[WEBHOOK] Received NEW_INBOX_MESSAGE:`, {
          message_uid: payload.message_uid,
          thread_uid: payload.thread_uid,
          agency_uid: payload.agency_uid,
        });

        if (dedup.isProcessed(payload.message_uid)) {
          console.log(`[WEBHOOK] Duplicate — already processed: ${payload.message_uid}`);
          return new Response(JSON.stringify({ ok: true, duplicate: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Mark processed before forwarding to prevent race conditions on concurrent delivery
        dedup.markProcessed(payload.message_uid);

        // Return 200 immediately — Hostfully expects a fast response, processing is async
        const response = new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });

        // Fire-and-forget: don't await so Hostfully gets the 200 without delay
        forwardToOpenClaw(payload).catch((err) =>
          console.error('[WEBHOOK] Forward failed:', err)
        );

        return response;
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  console.log(`[WEBHOOK] Webhook receiver listening on port ${PORT}`);
}
