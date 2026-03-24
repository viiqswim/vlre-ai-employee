import { test, expect, mock, beforeEach, afterEach, beforeAll, describe } from 'bun:test';
import type { PipelineContext, WebhookPayload } from './processor.ts';
import { buildApprovalBlocks } from '../slack-blocks/blocks.ts';
import type { LockDiagnosis } from '../lock-types.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { MultiPropertyKBReader } from '../kb-reader/multi-reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import type { SifelyClient } from '../sifely-client/sifely-client.ts';
import type { VlreHubClient } from '../vlre-hub-client/vlre-hub-client.ts';
import type { App } from '@slack/bolt';

mock.module('./rules-store.js', () => ({
  getConfirmedRules: mock(() => []),
  loadRules: mock(() => []),
  saveRules: mock(async () => {}),
  updateRule: mock(async () => null),
  addRule: mock(async () => {}),
  invalidateCache: mock(() => {}),
}));

let processWebhookMessage: (payload: WebhookPayload, context: PipelineContext) => Promise<void>;

beforeAll(async () => {
  const mod = await import('./processor.ts');
  processWebhookMessage = mod.processWebhookMessage;
});

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event_type: 'NEW_INBOX_MESSAGE',
    message_uid: 'msg-001',
    thread_uid: 'thread-001',
    agency_uid: 'agency-001',
    property_uid: 'prop-001',
    ...overrides,
  };
}

function makeMockSlackApp() {
  return {
    client: {
      chat: {
        postMessage: mock(() => Promise.resolve({ ok: true, ts: '1234567890.000001' })),
        update: mock(() => Promise.resolve({ ok: true })),
      },
    },
  } as unknown as App;
}

function makeMockHostfully(doorCode: string | null = '1234') {
  return {
    getMessage: mock(() =>
      Promise.resolve({
        uid: 'msg-001',
        content: 'I cannot open the door, please help!',
        senderType: 'GUEST',
        threadUid: 'thread-001',
        leadUid: 'lead-001',
        createdAt: '',
      }),
    ),
    getThread: mock(() =>
      Promise.resolve({
        uid: 'thread-001',
        participants: [{ participantType: 'LEAD', participantUid: 'lead-001', uid: 'p-001' }],
      }),
    ),
    getLead: mock(() =>
      Promise.resolve({
        uid: 'lead-001',
        propertyUid: 'prop-001',
        guestFirstName: 'John',
        guestLastName: 'Doe',
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-05',
        numberOfNights: 4,
        channel: 'AIRBNB',
      }),
    ),
    getProperty: mock(() => Promise.resolve({ uid: 'prop-001', name: 'Lakewood Retreat' })),
    getMessages: mock(() => Promise.resolve([])),
    getDoorCode: mock(() => Promise.resolve(doorCode)),
  } as unknown as HostfullyClient;
}

function makeMockKBReader() {
  return {
    search: mock((_q: string, _p?: string) => '## Access\nDoor code is in your booking confirmation.'),
  } as unknown as MultiPropertyKBReader;
}

function makeMockThreadTracker() {
  return {
    getPending: mock(() => undefined),
    track: mock(() => {}),
    clear: mock(() => {}),
  } as unknown as SlackThreadTracker;
}

function makeSifelyClient(passcode: string) {
  return {
    listPasscodes: mock(() =>
      Promise.resolve([
        {
          keyboardPwdId: 1,
          lockId: 'sifely-001',
          keyboardPwd: passcode,
          keyboardPwdName: 'Guest Code',
          keyboardPwdType: 2,
          startDate: 0,
          endDate: 0,
          status: 1,
        },
      ]),
    ),
    listAccessRecords: mock(() => Promise.resolve([])),
  } as unknown as SifelyClient;
}

function makeHubClient() {
  return {
    getLocksForProperty: mock(() =>
      Promise.resolve([
        {
          lockId: 'lock-001',
          sifelyLockId: 'sifely-001',
          lockName: 'Front Door',
          lockRole: 'FRONT_DOOR' as const,
        },
      ]),
    ),
  } as unknown as VlreHubClient;
}

function makeBaseContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    hostfullyClient: makeMockHostfully(),
    kbReader: makeMockKBReader(),
    slackApp: makeMockSlackApp(),
    slackChannelId: 'C0TEST',
    threadTracker: makeMockThreadTracker(),
    ...overrides,
  };
}

function mockClaudeWithCategory(category: string): typeof global.fetch {
  const responseBody = JSON.stringify({
    classification: 'NEEDS_APPROVAL',
    confidence: 0.9,
    reasoning: `Category resolved to ${category}`,
    draftResponse: `Response for ${category} issue.`,
    summary: `${category} issue — Lakewood Retreat`,
    category,
    conversationSummary: null,
    urgency: category === 'access',
  });
  return mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: responseBody } }],
          content: [{ type: 'text', text: responseBody }],
        }),
    } as Response),
  ) as unknown as typeof global.fetch;
}

const baseBlockParams = {
  guestName: 'John Doe',
  propertyName: 'Lakewood Retreat',
  checkInDate: '2026-04-01',
  checkOutDate: '2026-04-05',
  nightCount: 4,
  channel: 'AIRBNB',
  guestMessage: 'I cannot get in.',
  draftResponse: 'We are looking into your door code.',
  confidence: 0.9,
  classification: 'NEEDS_APPROVAL',
  summary: 'Access issue',
  conversationSummary: null,
  messageUid: 'msg-001',
  threadUid: 'thread-001',
  leadUid: 'lead-001',
  urgency: true,
};

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  process.env['OPENROUTER_API_KEY'] = 'sk-or-test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env['OPENROUTER_API_KEY'];
});

describe('buildApprovalBlocks — door code and lock features', () => {
  test('door code section rendered when doorCode provided', () => {
    const blocks = buildApprovalBlocks({ ...baseBlockParams, doorCode: '1234', lockDiagnosis: null });
    const text = JSON.stringify(blocks);
    expect(text).toContain('1234');
    expect(text).toContain('Door Code');
  });

  test('door code shows "Not configured" when doorCode is null', () => {
    const blocks = buildApprovalBlocks({ ...baseBlockParams, doorCode: null, lockDiagnosis: null });
    const text = JSON.stringify(blocks);
    expect(text).toContain('Not configured');
    expect(text).toContain('Door Code');
  });

  test('mismatch banner rendered when hasMismatch=true', () => {
    const diagnosis: LockDiagnosis = {
      hostfullyDoorCode: '1234',
      hasMismatch: true,
      diagnosisSummary:
        '⚠️ CODE MISMATCH DETECTED — Hostfully door code: 1234\n  ❌ Lock "Front Door" (FRONT_DOOR): has codes [9999]',
      locks: [
        {
          lock: { lockId: 'lock-001', sifelyLockId: 'sifely-001', lockName: 'Front Door', lockRole: 'FRONT_DOOR' },
          passcodes: [
            {
              keyboardPwdId: 1,
              lockId: 'sifely-001',
              keyboardPwd: '9999',
              keyboardPwdName: 'Guest Code',
              keyboardPwdType: 2,
              startDate: 0,
              endDate: 0,
              status: 1,
            },
          ],
          matchesHostfully: false,
          accessRecords: [],
        },
      ],
    };

    const blocks = buildApprovalBlocks({ ...baseBlockParams, doorCode: '1234', lockDiagnosis: diagnosis });
    const text = JSON.stringify(blocks);
    expect(text).toContain('MISMATCH');
    expect(text).toContain('CODE MISMATCH DETECTED');
    expect(text).toContain('1234');
  });

  test('no mismatch banner when lockDiagnosis is null', () => {
    const blocks = buildApprovalBlocks({ ...baseBlockParams, doorCode: '1234', lockDiagnosis: null });
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('MISMATCH');
    expect(text).not.toContain('CODE MISMATCH');
  });

  test('no mismatch banner when hasMismatch=false (codes all match)', () => {
    const diagnosis: LockDiagnosis = {
      hostfullyDoorCode: '1234',
      hasMismatch: false,
      diagnosisSummary: '✅ All lock codes match the door code (1234)',
      locks: [
        {
          lock: { lockId: 'lock-001', sifelyLockId: 'sifely-001', lockName: 'Front Door', lockRole: 'FRONT_DOOR' },
          passcodes: [
            {
              keyboardPwdId: 1,
              lockId: 'sifely-001',
              keyboardPwd: '1234',
              keyboardPwdName: 'Guest Code',
              keyboardPwdType: 2,
              startDate: 0,
              endDate: 0,
              status: 1,
            },
          ],
          matchesHostfully: true,
          accessRecords: [],
        },
      ],
    };

    const blocks = buildApprovalBlocks({ ...baseBlockParams, doorCode: '1234', lockDiagnosis: diagnosis });
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('CODE MISMATCH');
    expect(text).toContain('All lock codes match');
  });
});

describe('pipeline — lock integration', () => {
  test('access category: sifelyClient.listPasscodes is called (diagnosis triggered)', async () => {
    global.fetch = mockClaudeWithCategory('access');

    const sifelyClient = makeSifelyClient('1234');
    const vlreHubClient = makeHubClient();
    const context = makeBaseContext({ sifelyClient, vlreHubClient });

    await processWebhookMessage(makePayload(), context);

    expect((sifelyClient.listPasscodes as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  test('access category with mismatched passcode: Slack blocks contain MISMATCH banner', async () => {
    global.fetch = mockClaudeWithCategory('access');

    const sifelyClient = makeSifelyClient('9999');
    const vlreHubClient = makeHubClient();
    const context = makeBaseContext({ sifelyClient, vlreHubClient });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const callArgs = postCalls[0]?.[0] as { blocks: unknown[] };
    const blocksText = JSON.stringify(callArgs?.blocks);
    expect(blocksText).toContain('MISMATCH');
    expect(blocksText).toContain('1234');
  });

  test('wifi category: sifelyClient.listPasscodes is NOT called (diagnosis skipped)', async () => {
    global.fetch = mockClaudeWithCategory('wifi');

    const sifelyClient = makeSifelyClient('1234');
    const vlreHubClient = makeHubClient();
    const context = makeBaseContext({ sifelyClient, vlreHubClient });

    await processWebhookMessage(makePayload(), context);

    expect((sifelyClient.listPasscodes as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  test('wifi category: blocks contain Door Code but no MISMATCH banner', async () => {
    global.fetch = mockClaudeWithCategory('wifi');

    const sifelyClient = makeSifelyClient('1234');
    const vlreHubClient = makeHubClient();
    const context = makeBaseContext({ sifelyClient, vlreHubClient });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const callArgs = postCalls[0]?.[0] as { blocks: unknown[] };
    const blocksText = JSON.stringify(callArgs?.blocks);

    expect(blocksText).toContain('Door Code');
    expect(blocksText).toContain('1234');
    expect(blocksText).not.toContain('MISMATCH');
    expect(blocksText).not.toContain('CODE MISMATCH');
  });
});
