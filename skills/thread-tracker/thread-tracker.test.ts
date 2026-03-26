import { test, expect, beforeEach, afterEach } from "bun:test";
import { SlackThreadTracker, createThreadTracker } from "./thread-tracker";
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testFilePath: string;

beforeEach(() => {
  const tmpDir = join(tmpdir(), `thread-tracker-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  testFilePath = join(tmpDir, "pending-threads.json");
});

afterEach(() => {
  if (existsSync(testFilePath)) {
    unlinkSync(testFilePath);
  }
});

test("track stores entry and getPending returns it", () => {
  const tracker = createThreadTracker(testFilePath);
  const hostfullyThreadUid = "thread-123";
  const slackTs = "1234567890.123456";
  const channelId = "C0XXXXXXXXX";
  const messageUid = "msg-123";

  tracker.track(hostfullyThreadUid, slackTs, channelId, messageUid);
  const pending = tracker.getPending(hostfullyThreadUid);

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe(slackTs);
  expect(pending?.channelId).toBe(channelId);
  expect(pending?.messageUid).toBe(messageUid);
});

test("clear removes entry and getPending returns undefined after", () => {
  const tracker = createThreadTracker(testFilePath);
  const hostfullyThreadUid = "thread-456";

  tracker.track(hostfullyThreadUid, "1234567890.123456", "C0XXXXXXXXX", "msg-456");
  expect(tracker.getPending(hostfullyThreadUid)).toBeDefined();

  tracker.clear(hostfullyThreadUid);
  expect(tracker.getPending(hostfullyThreadUid)).toBeUndefined();
});

test("clear on non-existent key is a no-op (no error)", () => {
  const tracker = createThreadTracker(testFilePath);
  const nonExistentUid = "thread-does-not-exist";

  expect(() => {
    tracker.clear(nonExistentUid);
  }).not.toThrow();

  expect(tracker.getPending(nonExistentUid)).toBeUndefined();
});

test("state persists: write to file, create new instance from same file, verify data is there", () => {
  const hostfullyThreadUid = "thread-789";
  const slackTs = "9876543210.654321";
  const channelId = "C1YYYYYYYYY";
  const messageUid = "msg-789";

  // First instance: track data
  const tracker1 = createThreadTracker(testFilePath);
  tracker1.track(hostfullyThreadUid, slackTs, channelId, messageUid);

  // Second instance: load from same file
  const tracker2 = createThreadTracker(testFilePath);
  const pending = tracker2.getPending(hostfullyThreadUid);

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe(slackTs);
  expect(pending?.channelId).toBe(channelId);
  expect(pending?.messageUid).toBe(messageUid);
});

test("handles missing file gracefully (starts fresh)", () => {
  const tracker = createThreadTracker(testFilePath);

  // File doesn't exist yet, but tracker should initialize without error
  expect(tracker.getPending("any-uid")).toBeUndefined();

  // Should be able to track normally
  tracker.track("thread-new", "1111111111.111111", "C2ZZZZZZZZ", "msg-001");
  expect(tracker.getPending("thread-new")).toBeDefined();
});

test("track overwrites existing entry (upsert behavior)", () => {
  const tracker = createThreadTracker(testFilePath);
  const hostfullyThreadUid = "thread-upsert";

  // First track call
  tracker.track(hostfullyThreadUid, "1111111111.000001", "C0FIRST", "msg-first");
  let pending = tracker.getPending(hostfullyThreadUid);
  expect(pending?.slackTs).toBe("1111111111.000001");
  expect(pending?.channelId).toBe("C0FIRST");
  expect(pending?.messageUid).toBe("msg-first");

  // Second track call with same key, different values
  tracker.track(hostfullyThreadUid, "2222222222.000002", "C0SECOND", "msg-second");
  pending = tracker.getPending(hostfullyThreadUid);
  expect(pending?.slackTs).toBe("2222222222.000002");
  expect(pending?.channelId).toBe("C0SECOND");
  expect(pending?.messageUid).toBe("msg-second");
});

test("track stores messageUid and getPending returns it", () => {
  const tracker = createThreadTracker(testFilePath);
  const hostfullyThreadUid = "thread-msg-uid";
  const slackTs = "3333333333.333333";
  const channelId = "C0MSGUID";
  const messageUid = "msg-xyz";

  tracker.track(hostfullyThreadUid, slackTs, channelId, messageUid);
  const pending = tracker.getPending(hostfullyThreadUid);

  expect(pending).toBeDefined();
  expect(pending?.messageUid).toBe("msg-xyz");
  expect(pending?.slackTs).toBe(slackTs);
  expect(pending?.channelId).toBe(channelId);
});

test("handles legacy entries without messageUid (backward compat)", () => {
  // Write a legacy JSON file without messageUid
  writeFileSync(
    testFilePath,
    JSON.stringify({
      "thread-abc": { slackTs: "1111111111.000001", channelId: "C0LEGACY" },
    }, null, 2),
    "utf-8"
  );

  const tracker = createThreadTracker(testFilePath);
  const pending = tracker.getPending("thread-abc");

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe("1111111111.000001");
  expect(pending?.channelId).toBe("C0LEGACY");
  expect(pending?.messageUid).toBe("");
});

test("getAllPending returns all tracked threads", () => {
  const tracker = createThreadTracker(testFilePath);
  tracker.track("t1", "1000000000.000001", "C0AAAAAAAAA", "msg-1");
  tracker.track("t2", "1000000000.000002", "C0BBBBBBBBB", "msg-2");
  tracker.track("t3", "1000000000.000003", "C0CCCCCCCCC", "msg-3");

  const all = tracker.getAllPending();
  expect(Object.keys(all).length).toBe(3);
  expect(all["t1"]?.slackTs).toBe("1000000000.000001");
  expect(all["t2"]?.channelId).toBe("C0BBBBBBBBB");
  expect(all["t3"]?.messageUid).toBe("msg-3");
});

test("getAllPending on empty tracker returns {}", () => {
  const tracker = createThreadTracker(testFilePath);
  const all = tracker.getAllPending();
  expect(all).toEqual({});
});

test("getAllPending returns a copy — mutating returned object does not affect tracker", () => {
  const tracker = createThreadTracker(testFilePath);
  tracker.track("t1", "1000000000.000001", "C0AAAAAAAAA", "msg-1");

  const all = tracker.getAllPending();
  // Mutate the returned object
  delete (all as Record<string, unknown>)["t1"];

  // Tracker should still have the entry
  expect(tracker.getPending("t1")).toBeDefined();
  // And getAllPending should still return it
  expect(Object.keys(tracker.getAllPending()).length).toBe(1);
});

test("track with 5th metadata arg stores guestName and propertyName", () => {
  const tracker = createThreadTracker(testFilePath);
  tracker.track("t-meta", "1000000001.000001", "C0META", "msg-meta", {
    guestName: "John Doe",
    propertyName: "7213 Nutria Run",
  });

  const pending = tracker.getPending("t-meta");
  expect(pending?.guestName).toBe("John Doe");
  expect(pending?.propertyName).toBe("7213 Nutria Run");
});

test("track without 5th arg is backward compatible — no crash, metadata fields are undefined", () => {
  const tracker = createThreadTracker(testFilePath);
  expect(() => {
    tracker.track("t-noMeta", "1000000002.000002", "C0NOMETA", "msg-nometa");
  }).not.toThrow();

  const pending = tracker.getPending("t-noMeta");
  expect(pending).toBeDefined();
  expect(pending?.guestName).toBeUndefined();
  expect(pending?.propertyName).toBeUndefined();
});

test("updateReminderSentAt persists across new tracker instance", () => {
  const tracker1 = createThreadTracker(testFilePath);
  tracker1.track("t-remind", "1000000003.000003", "C0REMIND", "msg-remind");
  tracker1.updateReminderSentAt("t-remind", 1700000000000);

  const tracker2 = createThreadTracker(testFilePath);
  const pending = tracker2.getPending("t-remind");
  expect(pending?.lastReminderSentAt).toBe(1700000000000);
});

test("getPostedAtMs preserves millisecond precision using Math.floor", () => {
  expect(SlackThreadTracker.getPostedAtMs("1700000000.675929")).toBe(1700000000675);
});

test("getPostedAtMs on round timestamp returns correct value", () => {
  expect(SlackThreadTracker.getPostedAtMs("1234567890.123456")).toBe(1234567890123);
});

test("loading legacy JSON without new fields does not crash and fields are undefined", () => {
  writeFileSync(
    testFilePath,
    JSON.stringify({
      "thread-legacy": { slackTs: "1000000004.000004", channelId: "C0LEGACY2", messageUid: "msg-old" },
    }, null, 2),
    "utf-8"
  );

  const tracker = createThreadTracker(testFilePath);
  const pending = tracker.getPending("thread-legacy");

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe("1000000004.000004");
  expect(pending?.guestName).toBeUndefined();
  expect(pending?.propertyName).toBeUndefined();
  expect(pending?.lastReminderSentAt).toBeUndefined();
});

test("clear still works for threads with metadata", () => {
  const tracker = createThreadTracker(testFilePath);
  tracker.track("t-clearMeta", "1000000005.000005", "C0CLEARMETA", "msg-clearmeta", {
    guestName: "Jane Smith",
    propertyName: "3412 Sand Dunes Ave",
  });

  expect(tracker.getPending("t-clearMeta")).toBeDefined();
  tracker.clear("t-clearMeta");
  expect(tracker.getPending("t-clearMeta")).toBeUndefined();
});
