import { test, expect, mock, beforeEach, afterEach, spyOn, describe } from 'bun:test';
import { processWebhookMessage, parseClassifyResponse, buildLearnedRulesPrompt, SYSTEM_PROMPT, postFetchWarningToSlack } from './processor.ts';
import type { PipelineContext, WebhookPayload } from './processor.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { MultiPropertyKBReader } from '../kb-reader/multi-reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import type { App } from '@slack/bolt';
import { withRetry, isRetryableError } from './retry.js';
import type { LearnedRule } from './learned-rules.ts';
import type { NotionSearcher } from '../notion-search/notion-search.js';
import { buildErrorBlocks } from '../slack-blocks/blocks.ts';

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
    getMessages: mock(() => Promise.resolve([])),
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
  process.env['OPENROUTER_API_KEY'] = 'sk-or-test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env['OPENROUTER_API_KEY'];
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

  void 0;
  void 0;

  const searchMock = mock((_q: string, _p?: string) => '## WiFi\nNetwork: PapiWifi\nPassword: Papi2024');
  const context = makeContext({
    kbReader: { search: searchMock } as unknown as MultiPropertyKBReader,
  });

  await processWebhookMessage(makePayload(), context);

  expect(searchMock.mock.calls.length).toBe(1);
  expect(typeof searchMock.mock.calls[0]?.[0]).toBe('string');
  expect(searchMock.mock.calls[0]?.[1]).toBe('Lakewood Retreat');

  void 0;
  void 0;
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

  void 0;
  void 0;

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

  void 0;
  void 0;
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

  void 0;
  void 0;

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

  void 0;
  void 0;
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

  void 0;
  void 0;

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

  void 0;
  void 0;
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

  void 0;
  void 0;

  const context = makeContext();

  await processWebhookMessage(makePayload(), context);

  const updateCalls = (context.slackApp.client.chat.update as ReturnType<typeof mock>).mock.calls;
  expect(updateCalls.length).toBe(0);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const trackCalls = (context.threadTracker.track as ReturnType<typeof mock>).mock.calls;
  expect(trackCalls.length).toBe(1);

  void 0;
  void 0;
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

  void 0;
  void 0;

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

  void 0;
  void 0;
});

test('posts manual review to Slack when Claude call fails', async () => {
  global.fetch = mock(() => Promise.reject(new Error('proxy down'))) as unknown as typeof global.fetch;

  void 0;
  void 0;

  const context = makeContext();
  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const text = (postCalls[0]?.[0] as { text: string }).text;
  expect(text).toContain('Manual Review Required');

  void 0;
  void 0;
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

test('posts authentication failed error to Slack when getMessage returns 401', async () => {
  const context = makeContext({
    hostfullyClient: {
      ...makeContext().hostfullyClient,
      getMessage: mock(() =>
        Promise.reject(new Error('Hostfully API authentication failed (401) — check that HOSTFULLY_API_KEY is valid and has not been rotated'))
      ),
    } as unknown as HostfullyClient,
  });

  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const args = postCalls[0]?.[0] as { blocks: unknown[]; text: string };
  expect(Array.isArray(args?.blocks)).toBe(true);
  const blockContent = JSON.stringify(args.blocks);
  expect(blockContent).toMatch(/authentication failed/i);
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

test('posts Manual Review when OpenRouter fails', async () => {
  global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof global.fetch;

  const context = makeContext();
  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const text = (postCalls[0]?.[0] as { text: string }).text;
  expect(text).toContain('Manual Review Required');
});

test('posts 🔑 key rotation guidance when OpenRouter returns 401', async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(null, { status: 401, statusText: 'Unauthorized' })),
  ) as unknown as typeof global.fetch;

  const context = makeContext();
  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const text = (postCalls[0]?.[0] as { text: string }).text;
  expect(text).toContain('🔑');
  expect(text).toContain('OPENROUTER_API_KEY');
});

test('posts generic Classification failed message when OpenRouter returns 500', async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(null, { status: 500, statusText: 'Internal Server Error' })),
  ) as unknown as typeof global.fetch;

  const context = makeContext();
  await processWebhookMessage(makePayload(), context);

  const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const text = (postCalls[0]?.[0] as { text: string }).text;
  expect(text).toContain('Classification failed');
  expect(text).not.toContain('🔑');
});

test('postFetchWarningToSlack produces ⚠️ copy without Send failed', async () => {
  const mockApp = {
    client: {
      chat: {
        postMessage: mock(() => Promise.resolve({ ok: true, ts: '1234567890.000001' })),
      },
    },
  } as unknown as App;

  await postFetchWarningToSlack(mockApp, 'C0TEST', 'Failed to fetch message: 503 Service Unavailable', 'msg-001');

  const postCalls = (mockApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
  expect(postCalls.length).toBe(1);

  const message = postCalls[0]?.[0] as { text: string };
  expect(message.text).toContain('⚠️');
  expect(message.text).toContain('Could not process incoming message');
  expect(message.text).not.toContain('Send failed');
  expect(message.text).not.toContain('Please send manually');
});

test('buildErrorBlocks still contains Send failed copy (regression)', () => {
  const blocks = buildErrorBlocks('test error');
  const text = blocks
    .map((b: any) => (b as { text?: { text?: string } }).text?.text ?? '')
    .join('');
  expect(text).toContain('Send failed');
  expect(text).toContain('Please send manually');
});

describe('parseClassifyResponse', () => {
  test('parses urgency:true from JSON response', () => {
    const json = JSON.stringify({
      classification: 'NEEDS_APPROVAL',
      confidence: 0.95,
      reasoning: 'Guest locked out',
      draftResponse: 'We will send someone right away.',
      summary: 'Lockout emergency',
      category: 'access',
      conversationSummary: null,
      urgency: true,
    });
    const result = parseClassifyResponse(json);
    expect(result.urgency).toBe(true);
    expect(result.classification).toBe('NEEDS_APPROVAL');
    expect(result.confidence).toBe(0.95);
  });

  test('defaults urgency to false when field is missing', () => {
    const json = JSON.stringify({
      classification: 'NEEDS_APPROVAL',
      confidence: 0.8,
      reasoning: 'WiFi question',
      draftResponse: 'The WiFi password is Papi2024.',
      summary: 'WiFi request',
      category: 'wifi',
      conversationSummary: null,
    });
    const result = parseClassifyResponse(json);
    expect(result.urgency).toBe(false);
  });

  test('returns fallback with urgency:false when JSON is invalid', () => {
    const result = parseClassifyResponse('not valid json at all');
    expect(result.urgency).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.classification).toBe('NEEDS_APPROVAL');
  });

  test('extracts JSON wrapped in markdown code fence', () => {
    const wrapped = '```json\n' + JSON.stringify({
      classification: 'NEEDS_APPROVAL',
      confidence: 0.75,
      reasoning: 'Parking question',
      draftResponse: 'Parking is available in the driveway.',
      summary: 'Parking question',
      category: 'parking',
      conversationSummary: null,
      urgency: false,
    }) + '\n```';
    const result = parseClassifyResponse(wrapped);
    expect(result.confidence).toBe(0.75);
    expect(result.category).toBe('parking');
  });
});

describe('buildLearnedRulesPrompt', () => {
  test('returns "" for empty rules array', () => {
    expect(buildLearnedRulesPrompt([])).toBe('');
  });

  test('contains "LEARNED RULES FROM CS TEAM FEEDBACK" with confirmed rules', () => {
    const rules: LearnedRule[] = [
      {
        id: 'rule-001',
        pattern: 'avoid corporate phrases',
        correction: 'Do not use "I hope this message finds you well"',
        examples: [{ original: 'I hope this message finds you well.', edited: 'Hey John!' }],
        frequency: 5,
        status: 'confirmed',
        createdAt: '2026-03-01T00:00:00Z',
        confirmedAt: '2026-03-10T00:00:00Z',
      },
    ];
    const result = buildLearnedRulesPrompt(rules);
    expect(result).toContain('LEARNED RULES FROM CS TEAM FEEDBACK');
    expect(result).toContain('Do not use "I hope this message finds you well"');
    expect(result).toContain('5 CS team edits');
  });

  test('includes frequency count for each rule', () => {
    const rules: LearnedRule[] = [
      {
        id: 'rule-002',
        pattern: 'sign-off removal',
        correction: 'Never end with Best regards',
        examples: [],
        frequency: 12,
        status: 'confirmed',
        createdAt: '2026-03-01T00:00:00Z',
      },
    ];
    const result = buildLearnedRulesPrompt(rules);
    expect(result).toContain('12');
  });
});

describe('notionSearch integration', () => {
  function makeSuccessFetch() {
    return mock(() =>
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
                    reasoning: 'test',
                    draftResponse: 'Here is your answer.',
                    summary: 'Test question',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response)
    ) as unknown as typeof global.fetch;
  }

  test('pipeline without notionSearch completes successfully (backward compatible)', async () => {
    global.fetch = makeSuccessFetch();
    void 0;
    void 0;

    const context = makeContext();
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    void 0;
    void 0;
  });

  test('pipeline with notionSearch that throws: completes with KB context only (warning logged)', async () => {
    global.fetch = makeSuccessFetch();
    void 0;
    void 0;

    const mockNotionSearch = {
      search: mock(() => Promise.reject(new Error('Notion DB unavailable'))),
      formatAsContext: mock(() => ''),
    } as unknown as NotionSearcher;

    const context = makeContext({ notionSearch: mockNotionSearch });
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);
    expect((mockNotionSearch.search as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockNotionSearch.formatAsContext as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    void 0;
    void 0;
  });

  test('pipeline with notionSearch returning results: knowledgeBase passed to Claude includes Additional Context section', async () => {
    let capturedKnowledgeBase = '';
    global.fetch = mock((url: string | Request, opts?: RequestInit) => {
      if (opts?.body) {
        try {
          const body = JSON.parse(opts.body as string) as { messages?: Array<{ role: string; content: string }> };
          const userMsg = body.messages?.find(m => m.role === 'user');
          if (userMsg) capturedKnowledgeBase = userMsg.content;
        } catch (_) { }
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    classification: 'NEEDS_APPROVAL',
                    confidence: 0.9,
                    reasoning: 'test',
                    draftResponse: 'Here is your answer.',
                    summary: 'Test question',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response);
    }) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const mockNotionSearch = {
      search: mock(() => Promise.resolve([{ heading: 'Pets Policy', content: 'No pets allowed.', pageTitle: 'House Rules', score: 0.9 }])),
      formatAsContext: mock(() => '### Pets Policy (from: House Rules)\nNo pets allowed.'),
    } as unknown as NotionSearcher;

    const context = makeContext({ notionSearch: mockNotionSearch });
    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);
    expect((mockNotionSearch.search as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockNotionSearch.formatAsContext as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect(capturedKnowledgeBase).toContain('Additional Context (Company Wiki)');
    expect(capturedKnowledgeBase).toContain('No pets allowed.');

    void 0;
    void 0;
  });
});

describe('SYSTEM_PROMPT content', () => {
  test('contains "NEVER USE THESE PHRASES" section', () => {
    expect(SYSTEM_PROMPT).toContain('NEVER USE THESE PHRASES');
  });

  test('contains "TONE & STYLE RULES" section', () => {
    expect(SYSTEM_PROMPT).toContain('TONE & STYLE RULES');
  });

  test('contains "SIGNATURE RULES" section', () => {
    expect(SYSTEM_PROMPT).toContain('SIGNATURE RULES');
  });

  test('contains JSON format instruction with "urgency" field', () => {
    expect(SYSTEM_PROMPT).toContain('"urgency"');
  });
});

describe('conversation history', () => {
  test('includes conversation summary when prior messages exist', async () => {
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
                    reasoning: 'test',
                    draftResponse: 'So glad you enjoyed it!',
                    summary: 'Positive feedback',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response),
    ) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const context = makeContext({
      hostfullyClient: {
        ...makeContext().hostfullyClient,
        getMessages: mock(() =>
          Promise.resolve([
            {
              uid: 'msg-000',
              threadUid: 'thread-001',
              leadUid: 'lead-001',
              content: 'Hello, I have arrived!',
              senderType: 'GUEST',
              createdAt: '2026-03-13T10:00:00Z',
            },
            {
              uid: 'msg-001',
              threadUid: 'thread-001',
              leadUid: 'lead-001',
              content: 'Thank you so much, great place',
              senderType: 'GUEST',
              createdAt: '2026-03-14T09:00:00Z',
            },
          ]),
        ),
      } as unknown as HostfullyClient,
    });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    const blocks = (postCalls[0]?.[0] as { blocks: Array<{ type: string; text?: { text?: string }; elements?: unknown[] }> }).blocks;
    const summaryBlock = blocks.find((b) => b.type === 'section' && b.text?.text?.includes('Conversation so far'));
    expect(summaryBlock).toBeDefined();

    void 0;
    void 0;
  });

  test('filters messages to matching threadUid only', async () => {
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
                    reasoning: 'test',
                    draftResponse: 'Thanks!',
                    summary: 'Thanks',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response),
    ) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const context = makeContext({
      hostfullyClient: {
        ...makeContext().hostfullyClient,
        getMessages: mock(() =>
          Promise.resolve([
            {
              uid: 'msg-000',
              threadUid: 'thread-001',
              leadUid: 'lead-001',
              content: 'FROM_CORRECT_THREAD',
              senderType: 'GUEST',
              createdAt: '2026-03-13T10:00:00Z',
            },
            {
              uid: 'msg-999',
              threadUid: 'thread-OTHER',
              leadUid: 'lead-001',
              content: 'FROM_OTHER_THREAD',
              senderType: 'GUEST',
              createdAt: '2026-03-10T10:00:00Z',
            },
          ]),
        ),
      } as unknown as HostfullyClient,
    });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    const blocks = (postCalls[0]?.[0] as { blocks: Array<{ type: string; text?: { text?: string }; elements?: unknown[] }> }).blocks;

    const summaryBlock = blocks.find((b) => b.type === 'section' && b.text?.text?.includes('Conversation so far'));
    expect(summaryBlock).toBeDefined();

    const blocksStr = JSON.stringify(blocks);
    expect(blocksStr).not.toContain('FROM_OTHER_THREAD');
    expect(blocksStr).toContain('FROM_CORRECT_THREAD');

    void 0;
    void 0;
  });

  test('excludes the current message (message_uid) from conversation history', async () => {
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
                    reasoning: 'test',
                    draftResponse: 'Thanks!',
                    summary: 'Thanks',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response),
    ) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const context = makeContext({
      hostfullyClient: {
        ...makeContext().hostfullyClient,
        getMessages: mock(() =>
          Promise.resolve([
            {
              uid: 'msg-000',
              threadUid: 'thread-001',
              leadUid: 'lead-001',
              content: 'PRIOR_MESSAGE_CONTENT',
              senderType: 'GUEST',
              createdAt: '2026-03-13T10:00:00Z',
            },
            {
              uid: 'msg-001',
              threadUid: 'thread-001',
              leadUid: 'lead-001',
              content: 'CURRENT_MESSAGE_CONTENT',
              senderType: 'GUEST',
              createdAt: '2026-03-14T09:00:00Z',
            },
          ]),
        ),
      } as unknown as HostfullyClient,
    });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    const blocks = (postCalls[0]?.[0] as { blocks: Array<{ type: string; text?: { text?: string }; elements?: unknown[] }> }).blocks;

    const summaryBlock = blocks.find((b) => b.type === 'section' && b.text?.text?.includes('Conversation so far'));
    expect(summaryBlock).toBeDefined();
    expect(JSON.stringify(blocks)).toContain('PRIOR_MESSAGE_CONTENT');
    expect(summaryBlock?.text?.text).not.toContain('CURRENT_MESSAGE_CONTENT');

    void 0;
    void 0;
  });

  test('continues pipeline when getMessages throws', async () => {
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
                    reasoning: 'test',
                    draftResponse: 'Thanks!',
                    summary: 'Thanks',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response),
    ) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const context = makeContext({
      hostfullyClient: {
        ...makeContext().hostfullyClient,
        getMessages: mock(() => Promise.reject(new Error('API error fetching messages'))),
      } as unknown as HostfullyClient,
    });

    await processWebhookMessage(makePayload(), context);

    const postCalls = (context.slackApp.client.chat.postMessage as ReturnType<typeof mock>).mock.calls;
    expect(postCalls.length).toBe(1);

    void 0;
    void 0;
  });

  test('does not call getMessages when leadUid is empty', async () => {
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
                    confidence: 0.5,
                    reasoning: 'test',
                    draftResponse: 'Thanks!',
                    summary: 'Thanks',
                    category: 'other',
                    conversationSummary: null,
                    urgency: false,
                  }),
                },
              },
            ],
          }),
      } as Response),
    ) as unknown as typeof global.fetch;

    void 0;
    void 0;

    const getMessagesMock = mock(() => Promise.resolve([]));

    const context = makeContext({
      hostfullyClient: {
        ...makeContext().hostfullyClient,
        getThread: mock(() => Promise.resolve({ uid: 'thread-001', participants: [] })),
        getMessages: getMessagesMock,
      } as unknown as HostfullyClient,
    });

    const payload = makePayload({ lead_uid: undefined });
    await processWebhookMessage(payload, context);

    expect(getMessagesMock.mock.calls.length).toBe(0);

    void 0;
    void 0;
  });
});
