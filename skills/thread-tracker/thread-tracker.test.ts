import { test, expect, beforeEach, afterEach } from "bun:test";
import { SlackThreadTracker, createThreadTracker } from "./thread-tracker";
import { existsSync, unlinkSync, mkdirSync } from "fs";
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

  tracker.track(hostfullyThreadUid, slackTs, channelId);
  const pending = tracker.getPending(hostfullyThreadUid);

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe(slackTs);
  expect(pending?.channelId).toBe(channelId);
});

test("clear removes entry and getPending returns undefined after", () => {
  const tracker = createThreadTracker(testFilePath);
  const hostfullyThreadUid = "thread-456";

  tracker.track(hostfullyThreadUid, "1234567890.123456", "C0XXXXXXXXX");
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

  // First instance: track data
  const tracker1 = createThreadTracker(testFilePath);
  tracker1.track(hostfullyThreadUid, slackTs, channelId);

  // Second instance: load from same file
  const tracker2 = createThreadTracker(testFilePath);
  const pending = tracker2.getPending(hostfullyThreadUid);

  expect(pending).toBeDefined();
  expect(pending?.slackTs).toBe(slackTs);
  expect(pending?.channelId).toBe(channelId);
});

test("handles missing file gracefully (starts fresh)", () => {
  const tracker = createThreadTracker(testFilePath);

  // File doesn't exist yet, but tracker should initialize without error
  expect(tracker.getPending("any-uid")).toBeUndefined();

  // Should be able to track normally
  tracker.track("thread-new", "1111111111.111111", "C2ZZZZZZZZ");
  expect(tracker.getPending("thread-new")).toBeDefined();
});
