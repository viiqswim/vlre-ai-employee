const webhookUid  = process.env['HOSTFULLY_WEBHOOK_UID'];
const apiKey      = process.env['HOSTFULLY_API_KEY'] ?? '';
const baseUrl     = (process.env['HOSTFULLY_API_URL'] ?? 'https://api.hostfully.com/api/v3.2').replace(/\/$/, '');

if (!webhookUid) {
  console.error('❌ HOSTFULLY_WEBHOOK_UID not set in environment');
  console.error('Usage: HOSTFULLY_WEBHOOK_UID=<uid> bun run scripts/deregister-webhook.ts');
  process.exit(1);
}

console.log('Deregistering webhook:', webhookUid);

const url = `${baseUrl}/webhooks/${webhookUid}`;

try {
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-HOSTFULLY-APIKEY': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (resp.ok || resp.status === 404) {
    console.log('✅ Webhook removed (or was not found)');
  } else {
    console.error('❌ Deregistration failed:', resp.status, resp.statusText);
    process.exit(1);
  }
} catch (err) {
  console.error('❌ Request failed:', (err as Error).message);
  process.exit(1);
}
