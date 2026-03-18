import { test, expect, beforeEach, afterEach } from 'bun:test';
import { appendAuditLog, createAuditLogger } from './audit-logger';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const TEST_LOG_FILE = '/tmp/test-audit.jsonl';

beforeEach(async () => {
  // Clean up test file before each test
  if (existsSync(TEST_LOG_FILE)) {
    await rm(TEST_LOG_FILE);
  }
});

afterEach(async () => {
  // Clean up test file after each test
  if (existsSync(TEST_LOG_FILE)) {
    await rm(TEST_LOG_FILE);
  }
});

test('appends valid JSON line to file', async () => {
  const entry = { action: 'approve', userId: 'U123', messageId: 'M456' };
  await appendAuditLog(entry, TEST_LOG_FILE);

  const content = await readFile(TEST_LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n');

  expect(lines.length).toBe(1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(parsed.action).toBe('approve');
  expect(parsed.userId).toBe('U123');
  expect(parsed.messageId).toBe('M456');
});

test('creates directory if missing', async () => {
  const nestedPath = '/tmp/test-audit-nested/subdir/audit.jsonl';
  const entry = { action: 'test' };

  await appendAuditLog(entry, nestedPath);

  const content = await readFile(nestedPath, 'utf-8');
  expect(content).toBeTruthy();

  // Cleanup
  await rm('/tmp/test-audit-nested', { recursive: true });
});

test('multiple appends produce multiple lines', async () => {
  const entries = [
    { action: 'approve', userId: 'U1' },
    { action: 'reject', userId: 'U2' },
    { action: 'edit', userId: 'U3' },
  ];

  for (const entry of entries) {
    await appendAuditLog(entry, TEST_LOG_FILE);
  }

  const content = await readFile(TEST_LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n');

  expect(lines.length).toBe(3);
  expect((JSON.parse(lines[0]!) as Record<string, unknown>).action).toBe('approve');
  expect((JSON.parse(lines[1]!) as Record<string, unknown>).action).toBe('reject');
  expect((JSON.parse(lines[2]!) as Record<string, unknown>).action).toBe('edit');
});

test('each line has a timestamp field', async () => {
  const entry = { action: 'test' };
  await appendAuditLog(entry, TEST_LOG_FILE);

  const content = await readFile(TEST_LOG_FILE, 'utf-8');
  const parsed = JSON.parse(content.trim());

  expect(parsed.timestamp).toBeTruthy();
  expect(typeof parsed.timestamp).toBe('string');
  // Verify it's a valid ISO string
  expect(() => new Date(parsed.timestamp)).not.toThrow();
});

test('createAuditLogger factory returns bound function', async () => {
  const logger = createAuditLogger(TEST_LOG_FILE);
  const entry = { action: 'factory_test', userId: 'U999' };

  await logger(entry);

  const content = await readFile(TEST_LOG_FILE, 'utf-8');
  const parsed = JSON.parse(content.trim());

  expect(parsed.action).toBe('factory_test');
  expect(parsed.userId).toBe('U999');
  expect(parsed.timestamp).toBeTruthy();
});
