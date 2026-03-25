import { test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebhookDeduplicator } from '../skills/dedup/dedup.ts';

// Tests verify the dedup timing pattern used by the webhook receiver:
// markInMemory → pipeline runs → markProcessed (success) or unmarkProcessed (failure)

let testDir: string;
let testFilePath: string;

beforeEach(() => {
  testDir = join(tmpdir(), `webhook-timing-test-${Date.now()}-${Math.random()}`);
  mkdirSync(testDir, { recursive: true });
  testFilePath = join(testDir, 'dedup.json');
});

afterEach(() => {
  Bun.spawnSync(['rm', '-rf', testDir]);
});

test('markInMemory blocks re-entry before disk write', () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = 'test-uid-timing';

  dedup.markInMemory(uid);
  // UID is in memory Set — isProcessed should return true
  expect(dedup.isProcessed(uid)).toBe(true);
  // But no file should exist yet
  expect(existsSync(testFilePath)).toBe(false);
});

test('markProcessed after pipeline success writes to disk', () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = 'test-uid-success';

  // Simulate: markInMemory (webhook receipt)
  dedup.markInMemory(uid);
  expect(existsSync(testFilePath)).toBe(false);

  // Simulate: markProcessed (pipeline success)
  dedup.markProcessed(uid);
  expect(existsSync(testFilePath)).toBe(true);

  // Verify persisted
  const content = readFileSync(testFilePath, 'utf-8');
  const parsed = JSON.parse(content) as { items: string[] };
  expect(parsed.items).toContain(uid);
});

test('unmarkProcessed after pipeline failure removes from Set and does not create file', () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = 'test-uid-failure';

  // Simulate: markInMemory (webhook receipt)
  dedup.markInMemory(uid);
  expect(dedup.isProcessed(uid)).toBe(true);

  // Simulate: pipeline fails → unmarkProcessed
  dedup.unmarkProcessed(uid);
  expect(dedup.isProcessed(uid)).toBe(false);
  // File should not exist (was never written since markProcessed was never called)
  expect(existsSync(testFilePath)).toBe(false);
});

test('concurrent delivery blocked by in-memory Set (markInMemory → isProcessed)', () => {
  const dedup = new WebhookDeduplicator(testFilePath);
  const uid = 'test-uid-concurrent';

  // First delivery
  expect(dedup.isProcessed(uid)).toBe(false);
  dedup.markInMemory(uid);

  // Second delivery (concurrent, before first pipeline finishes)
  expect(dedup.isProcessed(uid)).toBe(true); // Blocked!
});
