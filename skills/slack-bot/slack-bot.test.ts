import { test, expect, afterEach } from 'bun:test';
import { App } from '@slack/bolt';
import { createSlackApp } from './app.ts';
import { registerAllHandlers, appendAuditLog } from './handlers.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpLogFile = '';

afterEach(() => {
  if (tmpLogFile && existsSync(tmpLogFile)) {
    unlinkSync(tmpLogFile);
    tmpLogFile = '';
  }
});

test('createSlackApp returns an App instance', () => {
  const app = createSlackApp({
    botToken: 'xoxb-fake-000000000000-000000000000-xxxxxxxxxxxxxxxxxxxxxxxx',
    appToken: 'xapp-1-fake-token',
    channelId: 'C0TEST',
  });
  expect(app).toBeInstanceOf(App);
});

test('createSlackApp falls back to env vars without throwing', () => {
  const app = createSlackApp();
  expect(app).toBeInstanceOf(App);
});

test('registerAllHandlers registers handlers without throwing', () => {
  const app = createSlackApp({
    botToken: 'xoxb-fake-000000000000-000000000000-xxxxxxxxxxxxxxxxxxxxxxxx',
    appToken: 'xapp-1-fake-token',
  });

  const mockClient = {} as unknown as HostfullyClient;
  const mockTracker = {} as unknown as SlackThreadTracker;

  expect(() => {
    registerAllHandlers(app, mockClient, mockTracker);
  }).not.toThrow();
});

test('appendAuditLog writes a valid JSON line with timestamp', () => {
  const tmpDir = join(tmpdir(), `slack-bot-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  tmpLogFile = join(tmpDir, 'test-actions.jsonl');

  appendAuditLog({ action: 'approve', userId: 'U123', messageUid: 'msg-1', threadUid: 'thread-1' }, tmpLogFile);

  expect(existsSync(tmpLogFile)).toBe(true);
  const content = readFileSync(tmpLogFile, 'utf-8');
  const lines = content.trim().split('\n');
  expect(lines.length).toBe(1);

  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(parsed['action']).toBe('approve');
  expect(parsed['userId']).toBe('U123');
  expect(typeof parsed['timestamp']).toBe('string');
  expect(new Date(parsed['timestamp'] as string).getTime()).not.toBeNaN();
});

test('appendAuditLog creates missing log directory automatically', () => {
  const tmpDir = join(tmpdir(), `slack-bot-test-newdir-${Date.now()}`, 'nested', 'logs');
  tmpLogFile = join(tmpDir, 'actions.jsonl');

  appendAuditLog({ action: 'reject', userId: 'U456' }, tmpLogFile);

  expect(existsSync(tmpLogFile)).toBe(true);
});

test('appendAuditLog appends multiple entries as separate lines', () => {
  const tmpDir = join(tmpdir(), `slack-bot-test-multi-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  tmpLogFile = join(tmpDir, 'multi.jsonl');

  appendAuditLog({ action: 'approve', userId: 'U1' }, tmpLogFile);
  appendAuditLog({ action: 'reject', userId: 'U2' }, tmpLogFile);
  appendAuditLog({ action: 'edit', userId: 'U3' }, tmpLogFile);

  const content = readFileSync(tmpLogFile, 'utf-8');
  const lines = content.trim().split('\n');
  expect(lines.length).toBe(3);

  const first = JSON.parse(lines[0]!) as Record<string, unknown>;
  const last = JSON.parse(lines[2]!) as Record<string, unknown>;
  expect(first['action']).toBe('approve');
  expect(last['action']).toBe('edit');
});
