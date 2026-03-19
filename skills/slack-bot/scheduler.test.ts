import { test, expect, beforeEach, afterEach } from 'bun:test';
import type { App } from '@slack/bolt';
import { startScheduler, stopScheduler, checkMissedRun } from './scheduler.ts';
import { invalidateCache, setLastAnalyzed } from '../pipeline/rules-store.ts';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RULES_FILE = resolve('data/learned-rules.json');

function cleanupTestFiles(): void {
  if (existsSync(RULES_FILE)) unlinkSync(RULES_FILE);
  const today = new Date().toISOString().split('T')[0]!;
  const recapFile = resolve(`logs/weekly-recap-${today}.md`);
  if (existsSync(recapFile)) unlinkSync(recapFile);
  invalidateCache();
}

function makeMockApp(onPostMessage?: (...args: unknown[]) => unknown): App {
  return {
    client: {
      chat: {
        postMessage: onPostMessage ?? (async () => ({ ok: true })),
      },
    },
  } as unknown as App;
}

beforeEach(() => {
  stopScheduler();
  cleanupTestFiles();
  mkdirSync('data', { recursive: true });
  mkdirSync('logs', { recursive: true });
});

afterEach(() => {
  stopScheduler();
  cleanupTestFiles();
});

test('startScheduler does not throw', () => {
  expect(() => startScheduler(makeMockApp(), 'C123')).not.toThrow();
});

test('stopScheduler without prior startScheduler does not throw', () => {
  expect(() => stopScheduler()).not.toThrow();
});

test('stopScheduler after startScheduler does not throw', () => {
  startScheduler(makeMockApp(), 'C123');
  expect(() => stopScheduler()).not.toThrow();
});

test('checkMissedRun posts recap when never analyzed', async () => {
  let callCount = 0;
  let lastCallArgs: Record<string, unknown> | null = null;

  const app = makeMockApp(async (args: unknown) => {
    callCount++;
    lastCallArgs = args as Record<string, unknown>;
    return { ok: true };
  });

  await checkMissedRun(app, 'C0TEST');

  expect(callCount).toBe(1);
  expect(lastCallArgs).not.toBeNull();
  expect(lastCallArgs!['channel']).toBe('C0TEST');
  expect(lastCallArgs!['text']).toBe('📊 Weekly Rules Recap');
});

test('checkMissedRun skips analysis when last run was within 7 days', async () => {
  await setLastAnalyzed(new Date().toISOString());

  let callCount = 0;
  const app = makeMockApp(async () => {
    callCount++;
    return { ok: true };
  });

  await checkMissedRun(app, 'C0TEST');

  expect(callCount).toBe(0);
});

test('checkMissedRun triggers analysis when last run was over 7 days ago', async () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await setLastAnalyzed(eightDaysAgo);

  let callCount = 0;
  const app = makeMockApp(async () => {
    callCount++;
    return { ok: true };
  });

  await checkMissedRun(app, 'C0TEST');

  expect(callCount).toBe(1);
});

test('overlap guard prevents concurrent runs', async () => {
  let callCount = 0;
  const app = makeMockApp(async () => {
    callCount++;
    return { ok: true };
  });

  const firstRun = checkMissedRun(app, 'C0TEST');
  const secondRun = checkMissedRun(app, 'C0TEST');
  await Promise.all([firstRun, secondRun]);

  expect(callCount).toBe(1);
});
