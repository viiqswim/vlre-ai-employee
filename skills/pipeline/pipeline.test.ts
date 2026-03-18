import { test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { processWebhookMessage } from './processor.ts';
import type { PipelineContext, WebhookPayload } from './processor.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { KnowledgeBaseReader } from '../kb-reader/reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import type { App } from '@slack/bolt';

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event_type: 'NEW_INBOX_MESSAGE',
    message_uid: 'msg-001',
    thread_uid: 'thread-001',
    agency_uid: 'agency-001',
    ...overrides,
  };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const mockSlackApp = {
    client: {
      chat: {
        postMessage: mock(() => Promise.resolve({ ok: true, ts: '1234567890.000001' })),
      },
    },
  } as unknown as App;

  const mockHostfully = {
    getMessage: mock(() =>
      Promise.resolve({ uid: 'msg-001', content: 'What is the WiFi password?', senderType: 'GUEST', threadUid: 'thread-001', leadUid: 'lead-001', createdAt: '' }),
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
        guestFirstName: 'Jane',
        guestLastName: 'Smith',
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-05',
        numberOfNights: 4,
        channel: 'AIRBNB',
      }),
    ),
    getProperty: mock(() =>
      Promise.resolve({ uid: 'prop-001', name: 'Lakewood Retreat' }),
    ),
  } as unknown as HostfullyClient;

  const mockKBReader = {
    search: mock(() => '## WiFi\nNetwork: PapiWifi\nPassword: Papi2024'),
  } as unknown as KnowledgeBaseReader;

  const mockThreadTracker = {
    getPending: mock(() => undefined),
    track: mock(() => {}),
    clear: mock(() => {}),
  } as unknown as SlackThreadTracker;

  return {
    hostfullyClient: mockHostfully,
    kbReader: mockKBReader,
    slackApp: mockSlackApp,
    slackChannelId: 'C0TEST',
    threadTracker: mockThreadTracker,
    ...overrides,
  };
}

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('ignores non-NEW_INBOX_MESSAGE events', async () => {
  const context = makeContext();
  const payload = makePayload({ event_type: 'BOOKING_CANCELLED' });

  await processWebhookMessage(payload, context);

  expect((context.hostfullyClient.getMessage as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  expect((context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls.length).toBe(0);
});

test('skips messages with missing message_uid', async () => {
  const context = makeContext();
  const payload = makePayload({ message_uid: '' });

  await processWebhookMessage(payload, context);

  expect((context.hostfullyClient.getMessage as ReturnType<typeof mock>).mock.calls.length).toBe(0);
});

test('skips non-guest senderType (PROPERTY_MANAGER)', async () => {
  const context = makeContext({
    hostfullyClient: {
      ...makeContext().hostfullyClient,
      getMessage: mock(() =>
        Promise.resolve({ uid: 'msg-001', content: 'PM message', senderType: 'PROPERTY_MANAGER', threadUid: 'thread-001', leadUid: 'lead-001', createdAt: '' }),
      ),
    } as unknown as HostfullyClient,
  });
  const payload = makePayload();

  await processWebhookMessage(payload, context);

  expect((context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls.length).toBe(0);
});

test('skips empty message content', async () => {
  const context = makeContext({
    hostfullyClient: {
      ...makeContext().hostfullyClient,
      getMessage: mock(() =>
        Promise.resolve({ uid: 'msg-001', content: '   ', senderType: 'GUEST', threadUid: 'thread-001', leadUid: 'lead-001', createdAt: '' }),
      ),
    } as unknown as HostfullyClient,
  });
  const payload = makePayload();

  await processWebhookMessage(payload, context);

  expect((context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls.length).toBe(0);
});

test('full pipeline: posts approval message to Slack on success', async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classification: 'NEEDS_APPROVAL',
                  confidence: 0.9,
                  reasoning: 'Direct KB match',
                  draftResponse: 'The WiFi password is Papi2024.',
                  summary: 'WiFi request — Lakewood Retreat',
                  category: 'wifi',
                  conversationSummary: null,
                }),
              },
            },
          ],
        }),
    } as Response)
  ) as unknown as typeof global.fetch;

  process.env['CLAUDE_MODE'] = 'proxy';
  process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

  const context = makeContext();
  const payload = makePayload();

  await processWebhookMessage(payload, context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const callArgs = postCalls[0]?.[0] as { channel: string; text: string; blocks: unknown[] };
  expect(callArgs?.channel).toBe('C0TEST');
  expect(typeof callArgs?.text).toBe('string');
  expect(Array.isArray(callArgs?.blocks)).toBe(true);

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('posts as thread reply when pending thread exists', async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classification: 'NEEDS_APPROVAL',
                  confidence: 0.8,
                  reasoning: 'follow-up',
                  draftResponse: 'Here is more info.',
                  summary: 'Follow-up question',
                  category: 'other',
                  conversationSummary: 'Guest asked about WiFi. Now asking about parking.',
                }),
              },
            },
          ],
        }),
    } as Response)
  ) as unknown as typeof global.fetch;

  process.env['CLAUDE_MODE'] = 'proxy';
  process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

  const context = makeContext({
    threadTracker: {
      getPending: mock(() => ({ slackTs: '9999999999.000001', channelId: 'C0TEST' })),
      track: mock(() => {}),
      clear: mock(() => {}),
    } as unknown as SlackThreadTracker,
  });

  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const callArgs = postCalls[0]?.[0] as { thread_ts?: string };
  expect(callArgs?.thread_ts).toBe('9999999999.000001');

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(0);

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('posts manual review to Slack when Claude call fails', async () => {
  global.fetch = mock(() => Promise.reject(new Error('proxy down'))) as unknown as typeof global.fetch;

  process.env['CLAUDE_MODE'] = 'proxy';
  process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

  const context = makeContext();
  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const text = (postCalls[0]?.[0] as { text: string }).text;
  expect(text).toContain('Manual Review Required');

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('posts error to Slack when getMessage fails', async () => {
  const context = makeContext({
    hostfullyClient: {
      getMessage: mock(() => Promise.reject(new Error('API error'))),
    } as unknown as HostfullyClient,
  });

  global.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)) as unknown as typeof global.fetch;

  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const args = postCalls[0]?.[0] as { blocks: unknown[] };
  expect(Array.isArray(args?.blocks)).toBe(true);
});
