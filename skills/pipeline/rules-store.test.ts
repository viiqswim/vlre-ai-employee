import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  loadRules,
  getConfirmedRules,
  saveRules,
  updateRule,
  addRule,
  invalidateCache,
  getLastAnalyzed,
  setLastAnalyzed,
} from './rules-store.js';
import type { LearnedRule } from './learned-rules.js';
import { existsSync } from 'node:fs';
import { unlink, mkdir } from 'node:fs/promises';

const RULES_FILE = 'data/learned-rules.json';
const RULES_TMP = 'data/learned-rules.tmp.json';

function makeRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: 'rule-test-1',
    pattern: 'AI adds greeting',
    correction: 'Do not add formal greetings',
    examples: [],
    frequency: 1,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function cleanupRulesFile(): Promise<void> {
  try {
    if (existsSync(RULES_FILE)) await unlink(RULES_FILE);
  } catch { /* ignore */ }
  try {
    if (existsSync(RULES_TMP)) await unlink(RULES_TMP);
  } catch { /* ignore */ }
}

beforeEach(async () => {
  invalidateCache();
  await cleanupRulesFile();
});

afterEach(async () => {
  invalidateCache();
  await cleanupRulesFile();
});

describe('Scenario 1: Load rules from non-existent file', () => {
  test('loadRules() returns [] when data/learned-rules.json does not exist', () => {
    const rules = loadRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBe(0);
  });

  test('getConfirmedRules() returns [] when file does not exist', () => {
    const confirmed = getConfirmedRules();
    expect(Array.isArray(confirmed)).toBe(true);
    expect(confirmed.length).toBe(0);
  });

  test('getLastAnalyzed() returns null when file does not exist', () => {
    expect(getLastAnalyzed()).toBeNull();
  });
});

describe('Scenario 2: Atomic write — temp file cleaned up', () => {
  test('saveRules() writes to final file and removes temp file', async () => {
    const rule = makeRule({ id: 'test-1', pattern: 'test', correction: 'fix' });
    await saveRules([rule]);

    expect(existsSync(RULES_FILE)).toBe(true);
    expect(existsSync(RULES_TMP)).toBe(false);
  });

  test('saveRules() stores rule that can be read back by loadRules()', async () => {
    const rule = makeRule({ id: 'test-1' });
    await saveRules([rule]);

    invalidateCache();
    const rules = loadRules();
    expect(rules.length).toBe(1);
    expect(rules[0]?.id).toBe('test-1');
  });

  test('saveRules() written file contains valid JSON with rules array', async () => {
    const rule = makeRule({ id: 'test-1' });
    await saveRules([rule]);

    const content = await Bun.file(RULES_FILE).text();
    const parsed = JSON.parse(content) as { rules: LearnedRule[]; lastAnalyzed: string | null; version: number };
    expect(Array.isArray(parsed.rules)).toBe(true);
    expect(parsed.rules.length).toBe(1);
    expect(parsed.rules[0]?.id).toBe('test-1');
  });
});

describe('Scenario 3: Idempotent approve — double-click safe', () => {
  test('updateRule() confirms a proposed rule', async () => {
    const rule = makeRule({ id: 'test-1', status: 'proposed' });
    await saveRules([rule]);

    const updated = await updateRule('test-1', { status: 'confirmed', confirmedAt: new Date().toISOString() });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('confirmed');
  });

  test('double-confirming the same rule does not create duplicates', async () => {
    const rule = makeRule({ id: 'test-1', status: 'proposed' });
    await saveRules([rule]);

    const ts = new Date().toISOString();
    await updateRule('test-1', { status: 'confirmed', confirmedAt: ts });
    await updateRule('test-1', { status: 'confirmed', confirmedAt: ts });

    invalidateCache();
    const rules = loadRules();
    expect(rules.length).toBe(1);
    expect(rules[0]?.status).toBe('confirmed');
  });

  test('second updateRule confirm call does not trigger another saveRules write (idempotent path)', async () => {
    const rule = makeRule({ id: 'test-1', status: 'proposed' });
    await saveRules([rule]);

    const ts = new Date().toISOString();
    const first = await updateRule('test-1', { status: 'confirmed', confirmedAt: ts });
    expect(first?.status).toBe('confirmed');

    const second = await updateRule('test-1', { status: 'confirmed', confirmedAt: ts });
    expect(second?.status).toBe('confirmed');
    expect(second?.id).toBe('test-1');
  });
});

describe('Scenario 4: Cache invalidation works', () => {
  test('getConfirmedRules() returns cached result before invalidation', async () => {
    const rule = makeRule({ id: 'rule-a', status: 'confirmed' });
    await saveRules([rule]);

    expect(getConfirmedRules().length).toBe(1);

    const secondRule: LearnedRule = {
      id: 'rule-b',
      pattern: 'second pattern',
      correction: 'fix b',
      examples: [],
      frequency: 1,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    const existingContent = await Bun.file(RULES_FILE).text();
    const parsed = JSON.parse(existingContent) as { rules: LearnedRule[]; lastAnalyzed: string | null; version: number };
    parsed.rules.push(secondRule);
    await Bun.write(RULES_FILE, JSON.stringify(parsed, null, 2) + '\n');

    expect(getConfirmedRules().length).toBe(1);

    invalidateCache();

    expect(getConfirmedRules().length).toBe(2);
  });
});

describe('Scenario 5: Duplicate pattern detection', () => {
  test('addRule() throws DUPLICATE_PATTERN when pattern already exists', async () => {
    const rule = makeRule({ id: 'rule-1', pattern: 'AI adds greeting' });
    await saveRules([rule]);

    const newRule = makeRule({ id: 'rule-2', pattern: 'AI adds greeting' });
    await expect(addRule(newRule)).rejects.toThrow('DUPLICATE_PATTERN');
  });

  test('addRule() successfully adds a rule with a unique pattern', async () => {
    const rule = makeRule({ id: 'rule-1', pattern: 'AI adds greeting' });
    await saveRules([rule]);

    const uniqueRule = makeRule({ id: 'rule-2', pattern: 'different pattern entirely' });
    await addRule(uniqueRule);

    invalidateCache();
    const rules = loadRules();
    expect(rules.length).toBe(2);
  });

  test('addRule() checks ALL statuses (not just confirmed) for duplicate patterns', async () => {
    const rejectedRule = makeRule({ id: 'rule-1', pattern: 'AI adds greeting', status: 'rejected' });
    await saveRules([rejectedRule]);

    const newRule = makeRule({ id: 'rule-2', pattern: 'AI adds greeting', status: 'proposed' });
    await expect(addRule(newRule)).rejects.toThrow('DUPLICATE_PATTERN');
  });
});

describe('setLastAnalyzed and getLastAnalyzed', () => {
  test('setLastAnalyzed() stores timestamp and getLastAnalyzed() retrieves it', async () => {
    const ts = '2026-03-19T12:00:00.000Z';
    await setLastAnalyzed(ts);

    invalidateCache();
    expect(getLastAnalyzed()).toBe(ts);
  });

  test('setLastAnalyzed() preserves existing rules', async () => {
    const rule = makeRule({ id: 'rule-1' });
    await saveRules([rule]);

    await setLastAnalyzed('2026-03-19T12:00:00.000Z');

    invalidateCache();
    const rules = loadRules();
    expect(rules.length).toBe(1);
    expect(rules[0]?.id).toBe('rule-1');
  });
});

describe('updateRule edge cases', () => {
  test('updateRule() returns null for non-existent rule id', async () => {
    await saveRules([]);
    const result = await updateRule('does-not-exist', { status: 'confirmed' });
    expect(result).toBeNull();
  });
});

describe('getConfirmedRules — excludes non-confirmed rules', () => {
  test('excludes proposed rules, includes only confirmed', async () => {
    const proposedRule = makeRule({ id: 'rule-proposed', status: 'proposed' });
    const confirmedRule = makeRule({
      id: 'rule-confirmed',
      status: 'confirmed',
      pattern: 'confirmed pattern only',
    });
    const rejectedRule = makeRule({
      id: 'rule-rejected',
      status: 'rejected',
      pattern: 'rejected pattern only',
    });

    await saveRules([proposedRule, confirmedRule, rejectedRule]);
    invalidateCache();

    const confirmed = getConfirmedRules();
    expect(confirmed.length).toBe(1);
    expect(confirmed[0]?.id).toBe('rule-confirmed');
    expect(confirmed.find((r) => r.status === 'proposed')).toBeUndefined();
    expect(confirmed.find((r) => r.status === 'rejected')).toBeUndefined();
  });

  test('returns empty array when all rules are proposed', async () => {
    const rule1 = makeRule({ id: 'rule-1', status: 'proposed', pattern: 'pattern one' });
    const rule2 = makeRule({ id: 'rule-2', status: 'proposed', pattern: 'pattern two' });

    await saveRules([rule1, rule2]);
    invalidateCache();

    const confirmed = getConfirmedRules();
    expect(confirmed.length).toBe(0);
  });
});
