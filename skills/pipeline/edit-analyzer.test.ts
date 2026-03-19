import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWeeklyAnalysis } from './edit-analyzer.js';
import { invalidateCache } from './rules-store.js';
import type { LearnedRule, LearnedRulesFile } from './learned-rules.js';

const TEST_LOG_PATH = 'logs/test-edit-analyzer.jsonl';
const RULES_FILE = 'data/learned-rules.json';

function auditEditLine(originalDraft: string, editedText: string): string {
  return JSON.stringify({
    action: 'edit',
    originalDraft,
    editedText,
    timestamp: new Date().toISOString(),
  });
}

function writeTestLog(lines: string[]): void {
  mkdirSync('logs', { recursive: true });
  writeFileSync(resolve(TEST_LOG_PATH), lines.join('\n') + '\n', 'utf-8');
}

function setupRulesFile(rules: LearnedRule[]): void {
  mkdirSync('data', { recursive: true });
  const data: LearnedRulesFile = { rules, lastAnalyzed: null, version: 1 };
  writeFileSync(resolve(RULES_FILE), JSON.stringify(data, null, 2), 'utf-8');
  invalidateCache();
}

function cleanupFiles(): void {
  if (existsSync(resolve(TEST_LOG_PATH))) unlinkSync(resolve(TEST_LOG_PATH));
  if (existsSync(resolve(RULES_FILE))) unlinkSync(resolve(RULES_FILE));
  invalidateCache();
}

beforeEach(() => {
  cleanupFiles();
  mkdirSync('logs', { recursive: true });
  mkdirSync('data', { recursive: true });
});

afterEach(() => {
  cleanupFiles();
});

describe('Scenario 1: Empty/missing audit log', () => {
  test('returns totalEdits=0 when log file is missing', async () => {
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.totalEdits).toBe(0);
  });

  test('returns no new proposed rules when log is missing', async () => {
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.newProposedRules.length).toBe(0);
  });

  test('still generates recap markdown file when log is missing', async () => {
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.recapMarkdownPath).not.toBeNull();
    expect(existsSync(result.recapMarkdownPath!)).toBe(true);
  });

  test('returns empty confirmed and rejected rule lists when no rules file', async () => {
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.existingConfirmedRules.length).toBe(0);
    expect(result.existingRejectedRules.length).toBe(0);
  });

  test('recap file contains no-patterns message when no edits', async () => {
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    const content = readFileSync(result.recapMarkdownPath!, 'utf-8');
    expect(content).toContain('Edits analyzed: 0');
    expect(content).toContain('_No new patterns detected yet.');
  });

  test('returns totalEdits=0 when log exists but is empty', async () => {
    writeTestLog([]);
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.totalEdits).toBe(0);
  });

  test('skips non-edit action entries', async () => {
    writeTestLog([
      JSON.stringify({ action: 'approve', timestamp: new Date().toISOString() }),
      JSON.stringify({ action: 'reject', timestamp: new Date().toISOString() }),
    ]);
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.totalEdits).toBe(0);
  });

  test('skips malformed JSONL lines', async () => {
    writeTestLog([
      '{invalid json',
      auditEditLine('Hi there.', 'There.'),
    ]);
    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.totalEdits).toBe(1);
  });
});

describe('Scenario 2: Detects greeting-removed pattern', () => {
  test('detects greeting-removed with 3 matching edits (frequency >= 2)', async () => {
    writeTestLog([
      auditEditLine('Hi there, your check-in is at 3pm.', 'Your check-in is at 3pm.'),
      auditEditLine('Hey there, the WiFi password is abc123.', 'The WiFi password is abc123.'),
      auditEditLine('Hi please use the side entrance.', 'Please use the side entrance.'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });

    expect(result.totalEdits).toBe(3);
    const greetingRule = result.newProposedRules.find(r =>
      r.pattern.toLowerCase().includes('greeting'),
    );
    expect(greetingRule).toBeDefined();
    expect(greetingRule!.frequency).toBeGreaterThanOrEqual(2);
  });

  test('detects signoff-removed pattern', async () => {
    writeTestLog([
      auditEditLine('Pool is heated.\nregards', 'Pool is heated.'),
      auditEditLine('Check-in is 3pm.\nsincerely', 'Check-in is 3pm.'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    const signoffRule = result.newProposedRules.find(r =>
      r.pattern.toLowerCase().includes('sign-off'),
    );
    expect(signoffRule).toBeDefined();
    expect(signoffRule!.frequency).toBe(2);
  });

  test('detects message-shortened pattern', async () => {
    const long = 'a'.repeat(200);
    const short = 'a'.repeat(100);
    writeTestLog([
      auditEditLine(long, short),
      auditEditLine(long + 'x', short + 'y'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    const shortenedRule = result.newProposedRules.find(r =>
      r.pattern.toLowerCase().includes('too long'),
    );
    expect(shortenedRule).toBeDefined();
    expect(shortenedRule!.frequency).toBe(2);
  });

  test('detects message-lengthened pattern', async () => {
    const short = 'a'.repeat(100);
    const long = 'a'.repeat(200);
    writeTestLog([
      auditEditLine(short, long),
      auditEditLine(short + 'x', long + 'y'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    const lengthenedRule = result.newProposedRules.find(r =>
      r.pattern.toLowerCase().includes('too short'),
    );
    expect(lengthenedRule).toBeDefined();
    expect(lengthenedRule!.frequency).toBe(2);
  });

  test('does NOT propose pattern with only 1 occurrence (below threshold)', async () => {
    writeTestLog([
      auditEditLine('Hi there, single edit.', 'Single edit.'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.newProposedRules.length).toBe(0);
    expect(result.totalEdits).toBe(1);
  });

  test('recap shows proposed rule details when rules are found', async () => {
    writeTestLog([
      auditEditLine('Hi there, check-in is 3pm.', 'Check-in is 3pm.'),
      auditEditLine('Hey there, pool is on the left.', 'Pool is on the left.'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    const content = readFileSync(result.recapMarkdownPath!, 'utf-8');
    expect(content).toContain('### Rule:');
    expect(content).toContain('greeting');
  });
});

describe('Scenario 3: Does not re-propose already-proposed rules', () => {
  test('skips existing proposed rules — they are not in newProposedRules', async () => {
    const existingRule: LearnedRule = {
      id: 'rule-existing-1',
      pattern: 'AI adds greeting (Hi/Hey) before answering',
      correction: 'Answer the question directly without starting with Hi/Hey',
      examples: [{ original: 'Hi there, old example', edited: 'Old example' }],
      frequency: 2,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    setupRulesFile([existingRule]);

    writeTestLog([
      auditEditLine('Hi there, the pool is available for your use.', 'The pool is available for your use.'),
      auditEditLine('Hey there, please contact us if you need assistance.', 'Please contact us if you need assistance.'),
      auditEditLine('Hi there, checkout is at 11am on your departure day.', 'Checkout is at 11am on your departure day.'),
    ]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.newProposedRules.length).toBe(0);
  });

  test('does not duplicate rules in learned-rules.json when pattern already proposed', async () => {
    const existingRule: LearnedRule = {
      id: 'rule-existing-1',
      pattern: 'AI adds greeting (Hi/Hey) before answering',
      correction: 'Answer the question directly without starting with Hi/Hey',
      examples: [{ original: 'Hi there, old example', edited: 'Old example' }],
      frequency: 2,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    setupRulesFile([existingRule]);

    writeTestLog([
      auditEditLine('Hi there, the pool is available for your use.', 'The pool is available for your use.'),
      auditEditLine('Hey there, please contact us if you need assistance.', 'Please contact us if you need assistance.'),
      auditEditLine('Hi there, checkout is at 11am on your departure day.', 'Checkout is at 11am on your departure day.'),
    ]);

    await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });

    const raw = readFileSync(resolve(RULES_FILE), 'utf-8');
    const data = JSON.parse(raw) as LearnedRulesFile;
    const greetingRules = data.rules.filter(
      r => r.pattern === 'AI adds greeting (Hi/Hey) before answering',
    );
    expect(greetingRules.length).toBe(1);
  });

  test('updates frequency on existing proposed rule', async () => {
    const existingRule: LearnedRule = {
      id: 'rule-existing-1',
      pattern: 'AI adds greeting (Hi/Hey) before answering',
      correction: 'Answer the question directly without starting with Hi/Hey',
      examples: [{ original: 'Hi there, old example', edited: 'Old example' }],
      frequency: 2,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    setupRulesFile([existingRule]);

    writeTestLog([
      auditEditLine('Hi there, the pool is available for your use.', 'The pool is available for your use.'),
      auditEditLine('Hey there, please contact us if you need assistance.', 'Please contact us if you need assistance.'),
      auditEditLine('Hi there, checkout is at 11am on your departure day.', 'Checkout is at 11am on your departure day.'),
    ]);

    await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });

    const raw = readFileSync(resolve(RULES_FILE), 'utf-8');
    const data = JSON.parse(raw) as LearnedRulesFile;
    const greetingRule = data.rules.find(
      r => r.pattern === 'AI adds greeting (Hi/Hey) before answering',
    );
    expect(greetingRule?.frequency).toBe(3);
  });

  test('preserves confirmed rules and reports them in existingConfirmedRules', async () => {
    const confirmedRule: LearnedRule = {
      id: 'rule-confirmed-1',
      pattern: 'AI adds greeting (Hi/Hey) before answering',
      correction: 'Answer the question directly without starting with Hi/Hey',
      examples: [{ original: 'Hi confirmed', edited: 'Confirmed' }],
      frequency: 5,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    setupRulesFile([confirmedRule]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.existingConfirmedRules.length).toBe(1);
    expect(result.existingConfirmedRules[0]!.id).toBe('rule-confirmed-1');
    expect(result.newProposedRules.length).toBe(0);
  });

  test('preserves rejected rules in existingRejectedRules', async () => {
    const rejectedRule: LearnedRule = {
      id: 'rule-rejected-1',
      pattern: 'AI adds sign-off or closing phrase',
      correction: 'End the message naturally after the last point, no sign-off',
      examples: [{ original: 'regards', edited: '' }],
      frequency: 3,
      status: 'rejected',
      createdAt: new Date().toISOString(),
    };
    setupRulesFile([rejectedRule]);

    const result = await runWeeklyAnalysis({ auditLogPath: TEST_LOG_PATH });
    expect(result.existingRejectedRules.length).toBe(1);
    expect(result.existingRejectedRules[0]!.id).toBe('rule-rejected-1');
  });
});
