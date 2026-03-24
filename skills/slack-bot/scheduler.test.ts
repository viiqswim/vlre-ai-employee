import { test, expect, beforeEach, afterEach } from 'bun:test';
import type { App } from '@slack/bolt';
import { startScheduler, stopScheduler } from './scheduler.ts';
import { invalidateCache } from '../pipeline/rules-store.ts';
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


