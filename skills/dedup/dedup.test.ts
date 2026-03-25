import { test, expect, beforeEach, afterEach } from "bun:test";
import { WebhookDeduplicator, createDeduplicator } from "./dedup";
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testDir: string;
let testFilePath: string;

beforeEach(() => {
  // Create a unique temp directory for each test
  testDir = join(tmpdir(), `dedup-test-${Date.now()}-${Math.random()}`);
  testFilePath = join(testDir, "processed-messages.txt");
});

afterEach(() => {
  const jsonPath = testFilePath.replace('.txt', '.json');
  if (existsSync(jsonPath)) unlinkSync(jsonPath);
  if (existsSync(testFilePath + '.bak')) unlinkSync(testFilePath + '.bak');
  if (existsSync(testFilePath)) unlinkSync(testFilePath);
  if (existsSync(testDir)) Bun.spawnSync(["rm", "-rf", testDir]);
});

test("isProcessed returns false for unknown UID", () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  expect(dedup.isProcessed("unknown-uid")).toBe(false);
});

test("markProcessed adds to Set and isProcessed returns true after", () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = "test-uid-123";

  expect(dedup.isProcessed(uid)).toBe(false);
  dedup.markProcessed(uid);
  expect(dedup.isProcessed(uid)).toBe(true);
});

test("markProcessed appends to file and persists", async () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = "test-uid-456";

  dedup.markProcessed(uid);

  expect(existsSync(testFilePath)).toBe(true);
  const content = await Bun.file(testFilePath).text();
  expect(content).toContain(uid);
});

test("loading from existing file restores state", () => {
  // First deduplicator marks some UIDs
  const dedup1 = new WebhookDeduplicator(testFilePath);
  dedup1.markProcessed("uid-1");
  dedup1.markProcessed("uid-2");
  dedup1.markProcessed("uid-3");

  // Second deduplicator loads from the same file
  const dedup2 = new WebhookDeduplicator(testFilePath);
  expect(dedup2.isProcessed("uid-1")).toBe(true);
  expect(dedup2.isProcessed("uid-2")).toBe(true);
  expect(dedup2.isProcessed("uid-3")).toBe(true);
  expect(dedup2.isProcessed("uid-4")).toBe(false);
});

test("handles missing file gracefully and starts fresh", () => {
  // Create deduplicator with non-existent file path
  const dedup = new WebhookDeduplicator(testFilePath);

  // Should start with empty set
  expect(dedup.getProcessedCount()).toBe(0);
  expect(dedup.isProcessed("any-uid")).toBe(false);

  // Should be able to mark processed
  dedup.markProcessed("new-uid");
  expect(dedup.isProcessed("new-uid")).toBe(true);
  expect(dedup.getProcessedCount()).toBe(1);
});

test("getProcessedCount returns correct count", () => {
  const dedup = new WebhookDeduplicator(testFilePath);

  expect(dedup.getProcessedCount()).toBe(0);

  dedup.markProcessed("uid-1");
  expect(dedup.getProcessedCount()).toBe(1);

  dedup.markProcessed("uid-2");
  expect(dedup.getProcessedCount()).toBe(2);

  // Marking same UID again should not increase count
  dedup.markProcessed("uid-1");
  expect(dedup.getProcessedCount()).toBe(2);
});

test("createDeduplicator factory function works with default path", () => {
  const dedup = createDeduplicator(testFilePath);
  expect(dedup).toBeInstanceOf(WebhookDeduplicator);
  expect(dedup.isProcessed("test")).toBe(false);
});

test("markProcessed does not duplicate entries in file", async () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = "unique-uid";

  dedup.markProcessed(uid);
  dedup.markProcessed(uid);
  dedup.markProcessed(uid);

  const content = await Bun.file(testFilePath).text();
  const parsed = JSON.parse(content);
  expect(parsed.items.length).toBe(1);
  expect(parsed.items[0]).toBe(uid);
});

test("handles multiple UIDs in file correctly", async () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uids = ["uid-a", "uid-b", "uid-c", "uid-d", "uid-e"];

  for (const uid of uids) {
    dedup.markProcessed(uid);
  }

  expect(dedup.getProcessedCount()).toBe(5);

  for (const uid of uids) {
    expect(dedup.isProcessed(uid)).toBe(true);
  }

  const content = await Bun.file(testFilePath).text();
  for (const uid of uids) {
    expect(content).toContain(uid);
  }
});

test("markProcessed writes JSON format { items: string[] }", async () => {
  const jsonPath = testFilePath.replace('.txt', '.json');
  const dedup = new WebhookDeduplicator(jsonPath);
  dedup.markProcessed("uid-json-1");
  dedup.markProcessed("uid-json-2");

  const content = await Bun.file(jsonPath).text();
  const parsed = JSON.parse(content);
  expect(parsed).toHaveProperty('items');
  expect(Array.isArray(parsed.items)).toBe(true);
  expect(parsed.items).toContain('uid-json-1');
  expect(parsed.items).toContain('uid-json-2');
});

test("loading from existing JSON file restores state", () => {
  const jsonPath = testFilePath.replace('.txt', '.json');
  mkdirSync(testDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify({ items: ['uid-a', 'uid-b'] }), 'utf-8');

  const dedup = new WebhookDeduplicator(jsonPath);
  expect(dedup.isProcessed('uid-a')).toBe(true);
  expect(dedup.isProcessed('uid-b')).toBe(true);
  expect(dedup.getProcessedCount()).toBe(2);
});

test("auto-migrates existing .txt file to .json on construction", () => {
  mkdirSync(testDir, { recursive: true });
  writeFileSync(testFilePath, 'uid-migrate-1\nuid-migrate-2\nuid-migrate-3\n', 'utf-8');

  const jsonPath = testFilePath.replace('.txt', '.json');
  const dedup = new WebhookDeduplicator(jsonPath);

  expect(dedup.getProcessedCount()).toBe(3);
  expect(dedup.isProcessed('uid-migrate-1')).toBe(true);
  expect(dedup.isProcessed('uid-migrate-2')).toBe(true);
  expect(dedup.isProcessed('uid-migrate-3')).toBe(true);
  expect(existsSync(jsonPath)).toBe(true);
  expect(existsSync(testFilePath + '.bak')).toBe(true);
});

test("unmarkProcessed removes UID from Set and JSON file", async () => {
  const jsonPath = testFilePath.replace('.txt', '.json');
  const dedup = new WebhookDeduplicator(jsonPath);
  dedup.markProcessed('uid-keep');
  dedup.markProcessed('uid-remove');

  expect(dedup.getProcessedCount()).toBe(2);
  dedup.unmarkProcessed('uid-remove');
  expect(dedup.getProcessedCount()).toBe(1);
  expect(dedup.isProcessed('uid-remove')).toBe(false);
  expect(dedup.isProcessed('uid-keep')).toBe(true);

  const content = await Bun.file(jsonPath).text();
  const parsed = JSON.parse(content);
  expect(parsed.items).not.toContain('uid-remove');
  expect(parsed.items).toContain('uid-keep');
});

test("markInMemory adds to Set without writing to file", () => {
  const jsonPath = testFilePath.replace('.txt', '.json');
  const dedup = new WebhookDeduplicator(jsonPath);
  dedup.markInMemory('uid-memory-only');

  expect(dedup.isProcessed('uid-memory-only')).toBe(true);
  expect(existsSync(jsonPath)).toBe(false);
});
