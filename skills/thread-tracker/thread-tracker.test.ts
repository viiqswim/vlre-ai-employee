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
