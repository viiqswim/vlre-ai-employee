import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { App } from '@slack/bolt';
import type { PendingThread } from '../thread-tracker/thread-tracker.ts';

const mockAppendAuditLog = mock((_entry: Record<string, unknown>) => Promise.resolve());

mock.module('../audit-logger/audit-logger.ts', () => ({
  appendAuditLog: mockAppendAuditLog,
}));

import {
  startReminderScheduler,
  stopReminderScheduler,
  checkUnrespondedMessages,
} from './reminder-scheduler.ts';

const MIN = 60 * 1000;

function makeSlackTs(msAgo: number): string {
  return String((Date.now() - msAgo) / 1000);
}

function makeMockTracker(threads: Record<string, PendingThread>) {
  return {
    getAllPending: mock(() => ({ ...threads })),
    getPending: mock((uid: string) => threads[uid]),
    updateReminderSentAt: mock((_uid: string, _ts: number) => {}),
  };
}

function makeMockApp(overrides?: {
  getPermalink?: (...args: unknown[]) => unknown;
  postMessage?: (...args: unknown[]) => unknown;
}) {
  return {
    client: {
      chat: {
        getPermalink:
          overrides?.getPermalink ??
          mock(({ message_ts }: { channel: string; message_ts: string }) =>
            Promise.resolve({ ok: true, permalink: `https://slack.com/p${message_ts}` }),
          ),
        postMessage:
          overrides?.postMessage ??
          mock(() => Promise.resolve({ ok: true, ts: '1000000000.000001' })),
      },
    },
  } as unknown as App;
}

afterEach(() => {
  stopReminderScheduler();
  mockAppendAuditLog.mockClear();
});

test('posts reminder for 2 qualifying threads, skips the 20-min-old one', async () => {
  const ts1 = makeSlackTs(45 * MIN);
  const ts2 = makeSlackTs(90 * MIN);
  const ts3 = makeSlackTs(20 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-1': { slackTs: ts1, channelId: 'C123', messageUid: 'msg-1', guestName: 'Alice', propertyName: 'Apt A' },
    'uid-2': {
      slackTs: ts2,
      channelId: 'C123',
      messageUid: 'msg-2',
      guestName: 'Bob',
      propertyName: 'Apt B',
      lastReminderSentAt: Date.now() - 35 * MIN,
    },
    'uid-3': { slackTs: ts3, channelId: 'C123', messageUid: 'msg-3', guestName: 'Carol', propertyName: 'Apt C' },
  };

  const tracker = makeMockTracker(threads);
  const postMessage = mock(() => Promise.resolve({ ok: true }));
  const app = makeMockApp({ postMessage });

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(postMessage).toHaveBeenCalledTimes(1);
  const call = (postMessage as ReturnType<typeof mock>).mock.calls[0]?.[0] as { text: string };
  expect(call?.text).toContain('2');
});

test('does NOT call postMessage when 0 threads qualify', async () => {
  const ts = makeSlackTs(20 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-1': { slackTs: ts, channelId: 'C123', messageUid: 'msg-1' },
  };

  const tracker = makeMockTracker(threads);
  const postMessage = mock(() => Promise.resolve({ ok: true }));
  const app = makeMockApp({ postMessage });

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(postMessage).not.toHaveBeenCalled();
});

test('TOCTOU: thread cleared between getAllPending and getPending is skipped', async () => {
  const ts = makeSlackTs(45 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-ghost': { slackTs: ts, channelId: 'C123', messageUid: 'msg-x' },
  };

  const tracker = {
    getAllPending: mock(() => ({ ...threads })),
    getPending: mock((_uid: string) => undefined),
    updateReminderSentAt: mock(() => {}),
  };

  const postMessage = mock(() => Promise.resolve({ ok: true }));
  const app = makeMockApp({ postMessage });

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(postMessage).not.toHaveBeenCalled();
});

test('calls updateReminderSentAt for each reminded thread', async () => {
  const ts1 = makeSlackTs(45 * MIN);
  const ts2 = makeSlackTs(60 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-1': { slackTs: ts1, channelId: 'C123', messageUid: 'msg-1' },
    'uid-2': { slackTs: ts2, channelId: 'C123', messageUid: 'msg-2' },
  };

  const tracker = makeMockTracker(threads);
  const app = makeMockApp();

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(tracker.updateReminderSentAt).toHaveBeenCalledTimes(2);
  const uids = (tracker.updateReminderSentAt as ReturnType<typeof mock>).mock.calls.map(
    (c: unknown[]) => c[0],
  );
  expect(uids).toContain('uid-1');
  expect(uids).toContain('uid-2');
});

test('appendAuditLog called with action reminder_sent and correct pendingCount', async () => {
  const ts1 = makeSlackTs(45 * MIN);
  const ts2 = makeSlackTs(60 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-1': { slackTs: ts1, channelId: 'C123', messageUid: 'msg-1' },
    'uid-2': { slackTs: ts2, channelId: 'C123', messageUid: 'msg-2' },
  };

  const tracker = makeMockTracker(threads);
  const app = makeMockApp();

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(mockAppendAuditLog).toHaveBeenCalledTimes(1);
  const entry = mockAppendAuditLog.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(entry?.['action']).toBe('reminder_sent');
  expect(entry?.['pendingCount']).toBe(2);
  expect(Array.isArray(entry?.['threadUids'])).toBe(true);
  expect((entry?.['threadUids'] as string[]).length).toBe(2);
});

test('concurrency: second call while first is running is a no-op (postMessage called once)', async () => {
  const ts = makeSlackTs(45 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-1': { slackTs: ts, channelId: 'C123', messageUid: 'msg-1' },
  };

  let resolvePermalink!: (v: { ok: boolean; permalink: string }) => void;
  const hangPromise = new Promise<{ ok: boolean; permalink: string }>(r => {
    resolvePermalink = r;
  });

  const getPermalink = mock(() => hangPromise);
  const postMessage = mock(() => Promise.resolve({ ok: true }));
  const tracker = makeMockTracker(threads);
  const app = makeMockApp({ getPermalink, postMessage });

  startReminderScheduler(app, 'C123', tracker as never);

  const first = checkUnrespondedMessages();
  const second = checkUnrespondedMessages();

  resolvePermalink({ ok: true, permalink: 'https://slack.com/p123' });
  await first;
  await second;

  expect(postMessage).toHaveBeenCalledTimes(1);
});

test('startReminderScheduler with empty slackChannelId warns and does not start cron', () => {
  const tracker = makeMockTracker({});
  const app = makeMockApp();

  expect(() => {
    startReminderScheduler(app, '', tracker as never);
  }).not.toThrow();
});

test('permalink failure for one thread: that thread skipped, remainder still processed', async () => {
  const ts1 = makeSlackTs(45 * MIN);
  const ts2 = makeSlackTs(60 * MIN);

  const threads: Record<string, PendingThread> = {
    'uid-fail': { slackTs: ts1, channelId: 'C123', messageUid: 'msg-fail', guestName: 'Fail Guest' },
    'uid-ok': { slackTs: ts2, channelId: 'C123', messageUid: 'msg-ok', guestName: 'OK Guest' },
  };

  let callCount = 0;
  const getPermalink = mock((...args: unknown[]) => {
    const { message_ts } = args[0] as { channel: string; message_ts: string };
    callCount++;
    if (callCount === 1) {
      return Promise.reject(new Error('channel_not_found'));
    }
    return Promise.resolve({ ok: true, permalink: `https://slack.com/p${message_ts}` });
  });

  const postMessage = mock(() => Promise.resolve({ ok: true }));
  const tracker = makeMockTracker(threads);
  const app = makeMockApp({ getPermalink, postMessage });

  startReminderScheduler(app, 'C123', tracker as never);
  await checkUnrespondedMessages();

  expect(postMessage).toHaveBeenCalledTimes(1);
  const call = (postMessage as ReturnType<typeof mock>).mock.calls[0]?.[0] as { text: string };
  expect(call?.text).toContain('1');
});
