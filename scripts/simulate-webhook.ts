import { readFileSync, existsSync } from 'node:fs';

const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  cyan:  '\x1b[36m',
};
const green  = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const red    = (s: string) => `${c.red}${s}${c.reset}`;
const cyan   = (s: string) => `${c.cyan}${s}${c.reset}`;
const dim    = (s: string) => `${c.dim}${s}${c.reset}`;
const bold   = (s: string) => `${c.bold}${s}${c.reset}`;

const args = process.argv.slice(2);
const listOnly    = args.includes('--list');
const force       = args.includes('--force');
const limitArg    = args[args.indexOf('--limit') + 1];
const limit       = limitArg ? parseInt(limitArg, 10) : 20;
const uidIdx      = args.indexOf('--uid');
const specificUid = uidIdx !== -1 ? args[uidIdx + 1] : null;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${bold('simulate-webhook')} — Fire a real Hostfully guest message at the local webhook

${bold('USAGE')}
  bun run scripts/simulate-webhook.ts [options]

${bold('OPTIONS')}
  ${cyan('--list')}          Show recent messages without firing anything
  ${cyan('--uid')} <id>      Fire a specific message UID
  ${cyan('--limit')} <n>     How many recent messages to scan (default: 20)
  ${cyan('--force')}         Re-fire even if already in the dedup store
  ${cyan('--help')}          Show this help

${bold('EXAMPLES')}
  bun run scripts/simulate-webhook.ts
  bun run scripts/simulate-webhook.ts --list --limit 50
  bun run scripts/simulate-webhook.ts --uid 406807c1-c25a-41c3-98bb-307e675cff9c
  bun run scripts/simulate-webhook.ts --force
`);
  process.exit(0);
}

const HOSTFULLY_API_KEY  = process.env['HOSTFULLY_API_KEY'] ?? '';
const HOSTFULLY_AGENCY_UID = process.env['HOSTFULLY_AGENCY_UID'] ?? '';
const HOSTFULLY_API_URL  = process.env['HOSTFULLY_API_URL'] ?? 'https://api.hostfully.com/api/v3.2';
const WEBHOOK_PORT       = parseInt(process.env['WEBHOOK_PORT'] ?? '3001', 10);

if (!HOSTFULLY_API_KEY || !HOSTFULLY_AGENCY_UID) {
  console.error(red('❌ Missing required env: HOSTFULLY_API_KEY, HOSTFULLY_AGENCY_UID'));
  process.exit(1);
}

const WEBHOOK_URL = `http://localhost:${WEBHOOK_PORT}/webhook`;
const DEDUP_FILE  = 'data/processed-messages.txt';

const processedIds = new Set<string>();
if (existsSync(DEDUP_FILE)) {
  readFileSync(DEDUP_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .forEach(id => processedIds.add(id.trim()));
}

interface HostfullyMessage {
  uid: string;
  threadUid?: string;
  leadUid?: string;
  senderType?: string;
  createdAt?: string;
  content?: { subject?: string | null; text?: string } | string;
}

interface MessagesListResponse {
  messages: HostfullyMessage[];
}

console.log(`\n${bold('🔍 Fetching recent Hostfully messages...')}\n`);

const listResp = await fetch(
  `${HOSTFULLY_API_URL}/messages?agencyUid=${HOSTFULLY_AGENCY_UID}&limit=${limit}&offset=0`,
  {
    headers: {
      'X-HOSTFULLY-APIKEY': HOSTFULLY_API_KEY,
      'Accept': 'application/json',
    },
  }
);

if (!listResp.ok) {
  console.error(red(`❌ Hostfully API error: ${listResp.status} ${listResp.statusText}`));
  process.exit(1);
}

const { messages } = await listResp.json() as MessagesListResponse;

const guestMessages = messages.filter(
  m => m.senderType === 'GUEST' || m.senderType === 'TRAVELER'
);

if (guestMessages.length === 0) {
  console.log(yellow('⚠️  No recent GUEST messages found.'));
  process.exit(0);
}

const UID_W     = 8;
const STATUS_W  = 9;
const CONTENT_W = 62;

const header = [
  '#'.padEnd(3),
  'UID'.padEnd(UID_W),
  'STATUS'.padEnd(STATUS_W),
  'MESSAGE PREVIEW',
].join('  ');

console.log(bold(header));
console.log(dim('─'.repeat(header.length)));

guestMessages.forEach((m, i) => {
  const shortUid  = m.uid.slice(0, UID_W);
  const text      = extractText(m.content);
  const preview   = text.replace(/\n/g, ' ').slice(0, CONTENT_W);
  const processed = processedIds.has(m.uid);
  const status    = processed ? dim('✓ sent') : green('⏳ new');
  const num       = String(i + 1).padEnd(3);

  console.log(`${num}  ${dim(shortUid)}  ${status.padEnd(STATUS_W + 9)}  ${preview}`);
});

console.log();

const newCount = guestMessages.filter(m => !processedIds.has(m.uid)).length;
const total    = guestMessages.length;
console.log(dim(`Showing ${total} guest messages — ${newCount} unprocessed, ${total - newCount} already sent`));
console.log();

if (listOnly) {
  process.exit(0);
}

let target: HostfullyMessage | undefined;

if (specificUid) {
  target = messages.find(m => m.uid === specificUid);

  if (!target) {
    console.log(dim(`  UID not in recent list — fetching from Hostfully...`));
    const r = await fetch(
      `${HOSTFULLY_API_URL}/messages/${specificUid}`,
      { headers: { 'X-HOSTFULLY-APIKEY': HOSTFULLY_API_KEY, 'Accept': 'application/json' } }
    );
    if (!r.ok) {
      console.error(red(`❌ Message not found: ${specificUid}`));
      process.exit(1);
    }
    const d = await r.json() as { message?: HostfullyMessage };
    target = d.message;
  }
} else {
  target = guestMessages.find(m => !processedIds.has(m.uid));

  if (!target) {
    if (force) {
      target = guestMessages[0];
      console.log(yellow('⚠️  All recent messages already processed — re-firing most recent (--force).'));
    } else {
      console.log(yellow('⚠️  All recent guest messages are already in the dedup store.'));
      console.log(dim('   Use --force to re-fire, or --uid <id> for a specific one.'));
      console.log(dim(`   Note: the dedup store (${DEDUP_FILE}) will reject it — pipeline skips duplicates.`));
      process.exit(0);
    }
  }
}

if (!target) {
  console.error(red('❌ No message to fire.'));
  process.exit(1);
}

const text = extractText(target.content);
console.log(bold('📨 Firing webhook for:'));
console.log(`   ${dim('UID:')}     ${target.uid}`);
console.log(`   ${dim('Thread:')}  ${target.threadUid ?? yellow('(not found — pipeline will fetch from lead)')}`);
if (target.leadUid) console.log(`   ${dim('Lead:')}    ${target.leadUid}`);
console.log(`   ${dim('Message:')} ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`);

if (processedIds.has(target.uid)) {
  console.log(yellow('\n   ⚠️  This UID is in the dedup store — pipeline will skip it unless you clear data/processed-messages.txt'));
}

console.log();

const healthResp = await fetch(`http://localhost:${WEBHOOK_PORT}/health`).catch(() => null);
if (!healthResp?.ok) {
  console.error(red(`❌ Local service not running at http://localhost:${WEBHOOK_PORT}`));
  console.error(dim('   Start it with: ./start.sh'));
  process.exit(1);
}

const payload = {
  event_type: 'NEW_INBOX_MESSAGE',
  agency_uid:  HOSTFULLY_AGENCY_UID,
  message_uid: target.uid,
  thread_uid:  target.threadUid ?? '',
  ...(target.leadUid ? { lead_uid: target.leadUid } : {}),
};

const webhookResp = await fetch(WEBHOOK_URL, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(payload),
});

if (webhookResp.ok) {
  console.log(green('✅ Webhook accepted!'));
  console.log(dim(`   → ${WEBHOOK_URL}`));
  console.log(dim(`   Payload: ${JSON.stringify(payload)}`));
  console.log(`\n   ${bold('Check OpenClaw')} for the forwarded payload.\n`);
} else {
  const errText = await webhookResp.text().catch(() => '');
  console.error(red(`❌ Webhook rejected: ${webhookResp.status} — ${errText}`));
  process.exit(1);
}

function extractText(content: HostfullyMessage['content']): string {
  if (!content) return '';
  if (typeof content === 'object') return content.text ?? '';
  return content;
}
