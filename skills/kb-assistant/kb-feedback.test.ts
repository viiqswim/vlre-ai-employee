import { test, expect, beforeEach, afterEach } from 'bun:test';
import { recordFeedback, loadFeedback, invalidateCache, KBFeedbackEntry } from './kb-feedback.js';
import { existsSync, unlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';

let testFilePath: string;

beforeEach(() => {
  invalidateCache();
  testFilePath = `/tmp/kb-feedback-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  process.env['KB_FEEDBACK_FILE'] = testFilePath;
});

afterEach(() => {
  invalidateCache();
  if (existsSync(testFilePath)) {
    unlinkSync(testFilePath);
  }
  const tmpPath = testFilePath.replace('.json', '.tmp.json');
  if (existsSync(tmpPath)) {
    unlinkSync(tmpPath);
  }
  delete process.env['KB_FEEDBACK_FILE'];
});

test('recordFeedback cold start: creates file with 1 entry', async () => {
  const entry = {
    type: 'correct' as const,
    question: 'What is the WiFi password?',
    aiAnswer: 'The WiFi password is in the welcome packet.',
    filePath: 'knowledge-base/properties/7213-nut.md',
    userId: 'user123',
  };

  await recordFeedback(entry);

  expect(existsSync(testFilePath)).toBe(true);

  const content = readFileSync(testFilePath, 'utf-8');
  const data = JSON.parse(content);

  expect(data.entries).toHaveLength(1);
  expect(data.version).toBe(1);

  const recorded = data.entries[0] as KBFeedbackEntry;
  expect(recorded.id).toBeDefined();
  expect(recorded.id).not.toBe('');
  expect(recorded.type).toBe('correct');
  expect(recorded.question).toBe('What is the WiFi password?');
  expect(recorded.aiAnswer).toBe('The WiFi password is in the welcome packet.');
  expect(recorded.filePath).toBe('knowledge-base/properties/7213-nut.md');
  expect(recorded.userId).toBe('user123');
  expect(recorded.timestamp).toBeDefined();
  expect(recorded.correction).toBeUndefined();
});

test('recordFeedback multiple appends: 3 calls returns 3 entries with unique ids', async () => {
  const entries = [
    {
      type: 'correct' as const,
      question: 'Q1',
      aiAnswer: 'A1',
      filePath: 'kb1.md',
      userId: 'user1',
    },
    {
      type: 'incorrect' as const,
      question: 'Q2',
      aiAnswer: 'A2',
      filePath: 'kb2.md',
      userId: 'user2',
    },
    {
      type: 'correct' as const,
      question: 'Q3',
      aiAnswer: 'A3',
      filePath: 'kb3.md',
      userId: 'user3',
    },
  ];

  for (const entry of entries) {
    await recordFeedback(entry);
  }

  const loaded = loadFeedback();
  expect(loaded).toHaveLength(3);

  const ids = loaded.map((e) => e.id);
  const uniqueIds = new Set(ids);
  expect(uniqueIds.size).toBe(3);

  expect(loaded[0]!.question).toBe('Q1');
  expect(loaded[1]!.question).toBe('Q2');
  expect(loaded[2]!.question).toBe('Q3');
});

test('entry schema: id is non-empty string, timestamp is ISO format, type is correct/incorrect', async () => {
  await recordFeedback({
    type: 'incorrect',
    question: 'Test Q',
    aiAnswer: 'Test A',
    filePath: 'test.md',
    userId: 'testuser',
  });

  const entries = loadFeedback();
  expect(entries).toHaveLength(1);

  const entry = entries[0]!;

  // id is non-empty string
  expect(typeof entry.id).toBe('string');
  expect(entry.id.length).toBeGreaterThan(0);

  // timestamp is ISO format (contains T and Z or +/-)
  expect(typeof entry.timestamp).toBe('string');
  expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  // type is one of the allowed values
  expect(['correct', 'incorrect']).toContain(entry.type);
});

test('correction field: recordFeedback with correction string stores it in entry', async () => {
  await recordFeedback({
    type: 'incorrect',
    question: 'What time is checkout?',
    aiAnswer: 'Checkout is at 11am',
    correction: 'Checkout is at 10am',
    filePath: 'knowledge-base/common.md',
    userId: 'user456',
  });

  const entries = loadFeedback();
  expect(entries).toHaveLength(1);

  const entry = entries[0]!;
  expect(entry.correction).toBe('Checkout is at 10am');
  expect(entry.type).toBe('incorrect');
});
