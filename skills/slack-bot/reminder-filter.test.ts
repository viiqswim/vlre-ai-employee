import { test, expect, describe } from "bun:test";
import {
  getThreadsNeedingReminder,
  PendingThreadEntry,
  REMINDER_THRESHOLD_MS,
  REMINDER_INTERVAL_MS,
} from "./reminder-filter";

describe("getThreadsNeedingReminder", () => {
  test("empty input returns empty array", () => {
    const result = getThreadsNeedingReminder({});
    expect(result).toEqual([]);
  });

  test("thread pending 31 min with no reminder is included", () => {
    const now = Date.now();
    const thirtyOneMinAgo = now - 31 * 60 * 1000;
    const slackTs = String(thirtyOneMinAgo / 1000) + ".000001";

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-1");
  });

  test("thread pending 29 min with no reminder is excluded", () => {
    const now = Date.now();
    const twentyNineMinAgo = now - 29 * 60 * 1000;
    const slackTs = String(twentyNineMinAgo / 1000) + ".000001";

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(0);
  });

  test("thread pending 60 min, last reminded 31 min ago is included (repeat due)", () => {
    const now = Date.now();
    const sixtyMinAgo = now - 60 * 60 * 1000;
    const slackTs = String(sixtyMinAgo / 1000) + ".000001";
    const thirtyOneMinAgo = now - 31 * 60 * 1000;

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
        lastReminderSentAt: thirtyOneMinAgo,
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-1");
  });

  test("thread pending 60 min, last reminded 29 min ago is excluded (too soon for repeat)", () => {
    const now = Date.now();
    const sixtyMinAgo = now - 60 * 60 * 1000;
    const slackTs = String(sixtyMinAgo / 1000) + ".000001";
    const twentyNineMinAgo = now - 29 * 60 * 1000;

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
        lastReminderSentAt: twentyNineMinAgo,
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(0);
  });

  test("thread pending 60 min, last reminded exactly 30 min ago is included (at threshold, inclusive)", () => {
    const now = Date.now();
    const sixtyMinAgo = now - 60 * 60 * 1000;
    const slackTs = String(sixtyMinAgo / 1000) + ".000001";
    const thirtyMinAgo = now - 30 * 60 * 1000;

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
        lastReminderSentAt: thirtyMinAgo,
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-1");
  });

  test("multiple threads: only qualifying ones returned", () => {
    const now = Date.now();
    const thirtyOneMinAgo = now - 31 * 60 * 1000;
    const twentyNineMinAgo = now - 29 * 60 * 1000;

    const threads: Record<string, PendingThreadEntry> = {
      "thread-old": {
        threadUid: "thread-old",
        slackTs: String(thirtyOneMinAgo / 1000) + ".000001",
        channelId: "C123",
        messageUid: "msg-1",
      },
      "thread-new": {
        threadUid: "thread-new",
        slackTs: String(twentyNineMinAgo / 1000) + ".000001",
        channelId: "C123",
        messageUid: "msg-2",
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-old");
  });

  test("result sorted oldest first: 3 threads (120min, 90min, 45min old)", () => {
    const now = Date.now();
    const oneHundredTwentyMinAgo = now - 120 * 60 * 1000;
    const ninetyMinAgo = now - 90 * 60 * 1000;
    const fortyFiveMinAgo = now - 45 * 60 * 1000;

    const threads: Record<string, PendingThreadEntry> = {
      "thread-45": {
        threadUid: "thread-45",
        slackTs: String(fortyFiveMinAgo / 1000) + ".000001",
        channelId: "C123",
        messageUid: "msg-1",
      },
      "thread-120": {
        threadUid: "thread-120",
        slackTs: String(oneHundredTwentyMinAgo / 1000) + ".000001",
        channelId: "C123",
        messageUid: "msg-2",
      },
      "thread-90": {
        threadUid: "thread-90",
        slackTs: String(ninetyMinAgo / 1000) + ".000001",
        channelId: "C123",
        messageUid: "msg-3",
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(3);
    expect(result[0]!.threadUid).toBe("thread-120");
    expect(result[1]!.threadUid).toBe("thread-90");
    expect(result[2]!.threadUid).toBe("thread-45");
  });

  test("edge case: very old timestamp (1 week ago) is included", () => {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const slackTs = String(oneWeekAgo / 1000) + ".000001";

    const threads: Record<string, PendingThreadEntry> = {
      "thread-ancient": {
        threadUid: "thread-ancient",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-ancient");
  });

  test("thread with lastReminderSentAt undefined is treated as never reminded", () => {
    const now = Date.now();
    const thirtyOneMinAgo = now - 31 * 60 * 1000;
    const slackTs = String(thirtyOneMinAgo / 1000) + ".000001";

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
        lastReminderSentAt: undefined,
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.threadUid).toBe("thread-1");
  });

  test("preserves all thread metadata in returned entries", () => {
    const now = Date.now();
    const thirtyOneMinAgo = now - 31 * 60 * 1000;
    const slackTs = String(thirtyOneMinAgo / 1000) + ".000001";

    const threads: Record<string, PendingThreadEntry> = {
      "thread-1": {
        threadUid: "thread-1",
        slackTs,
        channelId: "C123",
        messageUid: "msg-1",
        guestName: "John Doe",
        propertyName: "7213-NUT",
        lastReminderSentAt: undefined,
      },
    };

    const result = getThreadsNeedingReminder(threads, now);
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.threadUid).toBe("thread-1");
    expect(entry.slackTs).toBe(slackTs);
    expect(entry.channelId).toBe("C123");
    expect(entry.messageUid).toBe("msg-1");
    expect(entry.guestName).toBe("John Doe");
    expect(entry.propertyName).toBe("7213-NUT");
    expect(entry.lastReminderSentAt).toBeUndefined();
  });
});
