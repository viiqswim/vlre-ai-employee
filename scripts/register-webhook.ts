import { createHostfullyClient } from '../skills/hostfully-client/index.ts';

const client = createHostfullyClient();

const agencyUid   = process.env['HOSTFULLY_AGENCY_UID'] ?? '';
const WEBHOOK_URL = process.env['WEBHOOK_PUBLIC_URL'] ?? 'https://victors-macbook-pro.tail87bb5f.ts.net';
const CALLBACK_URL = `${WEBHOOK_URL}/webhook`;

if (!agencyUid) {
  console.error('❌ HOSTFULLY_AGENCY_UID not set in environment');
  process.exit(1);
}

console.log('Registering Hostfully webhook...');
console.log('Agency UID:', agencyUid);
console.log('Callback URL:', CALLBACK_URL);
console.log('');

try {
  const existing = await client.listWebhooks(agencyUid);

  const duplicate = existing.find(
    (w) => w.eventType === 'NEW_INBOX_MESSAGE' && w.callbackUrl === CALLBACK_URL
  );

  if (duplicate) {
    console.log('✅ Webhook already registered:', duplicate.uid);
    console.log('No action needed.');
    process.exit(0);
  }

  if (existing.length > 0) {
    console.log('Existing webhooks:');
    existing.forEach((w) => {
      console.log(`  - ${w.eventType} → ${w.callbackUrl}`);
    });
    console.log('');
  }
} catch (err) {
  console.warn('⚠️  Could not list existing webhooks:', (err as Error).message);
  console.log('Proceeding with registration...');
  console.log('');
}

try {
  const result = await client.registerWebhook(
    agencyUid,
    'NEW_INBOX_MESSAGE',
    CALLBACK_URL
  );

  console.log('✅ Webhook registered successfully!');
  console.log('  UID:', result.uid);
  console.log('  Event:', result.eventType);
  console.log('  URL:', result.callbackUrl);
  console.log('');
  console.log('Add to .env:');
  console.log(`HOSTFULLY_WEBHOOK_UID="${result.uid}"`);
  console.log('');

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('❌ Registration failed:', (err as Error).message);
  process.exit(1);
}
