import { test, expect, mock, beforeEach, afterEach, spyOn, describe } from 'bun:test';
import { processWebhookMessage } from './processor.ts';
import type { PipelineContext, WebhookPayload } from './processor.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { MultiPropertyKBReader } from '../kb-reader/multi-reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import type { App } from '@slack/bolt';
import { withRetry, isRetryableError } from './retry.js';

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
        update: mock(() => Promise.resolve({ ok: true })),
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
    search: mock((_query: string, _propertyName?: string) => '## WiFi\nNetwork: PapiWifi\nPassword: Papi2024'),
  } as unknown as MultiPropertyKBReader;

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

test('KB search is called with property name', async () => {
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

  const searchMock = mock((_q: string, _p?: string) => '## WiFi\nNetwork: PapiWifi\nPassword: Papi2024');
  const context = makeContext({
    kbReader: { search: searchMock } as unknown as MultiPropertyKBReader,
  });

  await processWebhookMessage(makePayload(), context);

  expect(searchMock.mock.calls.length).toBe(1);
  expect(typeof searchMock.mock.calls[0]?.[0]).toBe('string');
  expect(searchMock.mock.calls[0]?.[1]).toBe('Lakewood Retreat');

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
      getPending: mock(() => ({ slackTs: '9999999999.000001', channelId: 'C0TEST', messageUid: 'msg-old' })),
      track: mock(() => {}),
      clear: mock(() => {}),
    } as unknown as SlackThreadTracker,
  });

  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const callArgs = postCalls[0]?.[0] as { thread_ts?: string };
  expect(callArgs?.thread_ts).toBe('9999999999.000001');

  const updateCalls = (context.slackApp.client.chat.update as ReturnType<typeof mock>).mock.calls;
  expect(updateCalls.length).toBe(1);
  const updateArgs = updateCalls[0]?.[0] as { channel: string; ts: string };
  expect(updateArgs?.channel).toBe('C0TEST');
  expect(updateArgs?.ts).toBe('9999999999.000001');

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('supersedes old approval block when pending exists', async () => {
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

  const context = makeContext({
    threadTracker: {
      getPending: mock(() => ({ slackTs: '9999999999.000001', channelId: 'C0TEST', messageUid: 'msg-old' })),
      track: mock(() => {}),
      clear: mock(() => {}),
    } as unknown as SlackThreadTracker,
  });

  await processWebhookMessage(makePayload(), context);

  const updateCalls = (context.slackApp.client.chat.update as ReturnType<typeof mock>).mock.calls;
  expect(updateCalls.length).toBe(1);
  const updateArgs = updateCalls[0]?.[0] as { channel: string; ts: string; blocks: unknown[] };
  expect(updateArgs?.channel).toBe('C0TEST');
  expect(updateArgs?.ts).toBe('9999999999.000001');
  expect(Array.isArray(updateArgs?.blocks)).toBe(true);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);
  expect(trackCalls[0]?.[0]).toBe('thread-001');
  expect(trackCalls[0]?.[3]).toBe('msg-001');

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('continues posting new block when chat.update fails', async () => {
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

  const context = makeContext({
    slackApp: {
      client: {
        chat: {
          postMessage: mock(() => Promise.resolve({ ok: true, ts: '1234567890.000001' })),
          update: mock(() => Promise.reject(new Error('message_not_found'))),
        },
      },
    } as unknown as App,
    threadTracker: {
      getPending: mock(() => ({ slackTs: '9999999999.000001', channelId: 'C0TEST', messageUid: 'msg-old' })),
      track: mock(() => {}),
      clear: mock(() => {}),
    } as unknown as SlackThreadTracker,
  });

  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('does not call chat.update when no pending exists', async () => {
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
                  reasoning: 'first message',
                  draftResponse: 'Welcome!',
                  summary: 'First message',
                  category: 'other',
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

  await processWebhookMessage(makePayload(), context);

  const updateCalls = (context.slackApp.client.chat.update as ReturnType<typeof mock>).mock.calls;
  expect(updateCalls.length).toBe(0);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);

  delete process.env['CLAUDE_MODE'];
  delete process.env['CLAUDE_PROXY_URL'];
});

test('calls track() with messageUid on every successful post', async () => {
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
                  summary: 'Follow-up',
                  category: 'other',
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

  const context = makeContext({
    threadTracker: {
      getPending: mock(() => ({ slackTs: '9999999999.000001', channelId: 'C0TEST', messageUid: 'msg-old' })),
      track: mock(() => {}),
      clear: mock(() => {}),
    } as unknown as SlackThreadTracker,
  });

  await processWebhookMessage(makePayload(), context);

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);
  expect(trackCalls[0]?.[0]).toBe('thread-001');
  expect(trackCalls[0]?.[1]).toBe('1234567890.000001');
  expect(trackCalls[0]?.[2]).toBe('C0TEST');
  expect(trackCalls[0]?.[3]).toBe('msg-001');

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

describe('withRetry', () => {
  test('retries on TypeError("fetch failed") — Bun network error', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new TypeError('fetch failed');
      }
      return 'success';
    };

    const result = await withRetry(fn, { maxAttempts: 3, _sleep: () => Promise.resolve() });

    expect(callCount).toBe(3);
    expect(result).toBe('success');
  });

  test('does NOT retry non-transient errors', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error('invalid JSON response');
    };

    try {
      await withRetry(fn, { maxAttempts: 3, _sleep: () => Promise.resolve() });
      expect.unreachable();
    } catch (error) {
      expect(callCount).toBe(1);
      expect(error instanceof Error).toBe(true);
    }
  });

  test('exhausts maxAttempts then throws', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new TypeError('fetch failed');
    };

    try {
      await withRetry(fn, { maxAttempts: 3, _sleep: () => Promise.resolve() });
      expect.unreachable();
    } catch (error) {
      expect(callCount).toBe(3);
      expect(error instanceof TypeError).toBe(true);
    }
  });

  test('succeeds on 2nd attempt after 1st fails', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('fetch failed');
      }
      return 'success on 2nd';
    };

    const result = await withRetry(fn, { maxAttempts: 3, _sleep: () => Promise.resolve() });

    expect(callCount).toBe(2);
    expect(result).toBe('success on 2nd');
  });

  test('isRetryableError: TypeError("fetch failed") → true', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });

  test('isRetryableError: AbortError (timeout) → true', () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    expect(isRetryableError(e)).toBe(true);
  });

  test('isRetryableError: generic Error → false', () => {
    expect(isRetryableError(new Error('some business error'))).toBe(false);
  });
});

describe('proxy→API fallback', () => {
  test('falls back to Anthropic API when proxy fails and CLAUDE_FALLBACK_TO_API=true', async () => {
    global.fetch = mock(async (url: string | Request) => {
      const urlStr = typeof url === 'string' ? url : url.url;

      if (typeof urlStr === 'string' && urlStr.includes('api.anthropic.com')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    classification: 'general_inquiry',
                    confidence: 0.9,
                    suggestedResponse: 'Hello!',
                    reasoning: 'test',
                  }),
                },
              ],
            }),
        } as Response;
      }

      throw new TypeError('fetch failed');
    }) as unknown as typeof global.fetch;

    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_FALLBACK_TO_API'] = 'true';
    process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

    const context = makeContext();
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const firstCallArg = postCalls[0]?.[0] as { text?: string; blocks?: unknown[] };
    const hasManualReview = firstCallArg?.text?.includes('Manual Review Required') ?? false;
    expect(hasManualReview).toBe(false);

    delete process.env['CLAUDE_MODE'];
    delete process.env['CLAUDE_FALLBACK_TO_API'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  test('does NOT fall back when CLAUDE_FALLBACK_TO_API is unset', async () => {
    global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof global.fetch;

    process.env['CLAUDE_MODE'] = 'proxy';
    delete process.env['CLAUDE_FALLBACK_TO_API'];

    const context = makeContext();
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const text = (postCalls[0]?.[0] as { text: string }).text;
    expect(text).toContain('Manual Review Required');

    delete process.env['CLAUDE_MODE'];
  });

  test('posts Manual Review when both proxy and API fallback fail', async () => {
    global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof global.fetch;

    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_FALLBACK_TO_API'] = 'true';
    process.env['ANTHROPIC_API_KEY'] = 'test-key-123';

    const context = makeContext();
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const text = (postCalls[0]?.[0] as { text: string }).text;
    expect(text).toContain('Manual Review Required');

    delete process.env['CLAUDE_MODE'];
    delete process.env['CLAUDE_FALLBACK_TO_API'];
    delete process.env['ANTHROPIC_API_KEY'];
  });
});
