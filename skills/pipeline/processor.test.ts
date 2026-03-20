import { describe, test, expect, mock, beforeAll } from 'bun:test';
import type { LearnedRule } from './learned-rules.ts';

// mock.module MUST be called before processor.ts is imported — it calls getConfirmedRules() at load time
mock.module('./rules-store.ts', () => ({
  getConfirmedRules: mock(() => []),
  loadRules: mock(() => []),
  addRule: mock(async () => {}),
  updateRule: mock(async () => null),
  invalidateCache: mock(() => {}),
  saveRules: mock(async () => {}),
}));

let SYSTEM_PROMPT: string;
let buildLearnedRulesPrompt: (rules: LearnedRule[], propertyName?: string) => string;

beforeAll(async () => {
  const mod = await import('./processor.ts');
  SYSTEM_PROMPT = mod.SYSTEM_PROMPT;
  buildLearnedRulesPrompt = mod.buildLearnedRulesPrompt;
});

describe('SYSTEM_PROMPT tone rules', () => {
  test('contains explicit no-markdown rule', () => {
    expect(SYSTEM_PROMPT).toContain('NEVER use markdown');
  });

  test('contains no-numbered-lists rule', () => {
    expect(SYSTEM_PROMPT).toContain('NEVER use numbered lists');
  });

  test('contains no-bullet-points rule', () => {
    expect(SYSTEM_PROMPT).toContain('bullet points');
  });

  test('contains expanded AI-ism blocklist — delve', () => {
    expect(SYSTEM_PROMPT).toContain('delve');
  });

  test('contains expanded AI-ism blocklist — Great question', () => {
    expect(SYSTEM_PROMPT).toContain('Great question');
  });

  test('contains expanded AI-ism blocklist — multifaceted', () => {
    expect(SYSTEM_PROMPT).toContain('multifaceted');
  });

  test('contains response examples section', () => {
    expect(SYSTEM_PROMPT).toContain('GOOD RESPONSE EXAMPLES');
  });

  test('contains BAD response examples section', () => {
    expect(SYSTEM_PROMPT).toContain('BAD RESPONSE EXAMPLES');
  });

  test('preserves JSON response format — classification field', () => {
    expect(SYSTEM_PROMPT).toContain('"classification"');
  });

  test('preserves JSON response format — draftResponse field', () => {
    expect(SYSTEM_PROMPT).toContain('"draftResponse"');
  });

  test('preserves JSON response format — urgency field', () => {
    expect(SYSTEM_PROMPT).toContain('"urgency"');
  });

  test('preserves JSON response format — confidence field', () => {
    expect(SYSTEM_PROMPT).toContain('"confidence"');
  });
});

describe('buildLearnedRulesPrompt', () => {
  const globalRule: LearnedRule = {
    id: 'g1',
    pattern: 'AI adds greeting',
    correction: 'Answer directly without greeting',
    examples: [],
    frequency: 5,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: 'global',
  };

  const propertyRule: LearnedRule = {
    id: 'p1',
    pattern: 'AI misses garage parking',
    correction: 'Mention the garage parking option',
    examples: [],
    frequency: 2,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: '7213 Nutria Run',
  };

  const otherPropertyRule: LearnedRule = {
    id: 'p2',
    pattern: 'AI misses pool hours',
    correction: 'Mention pool hours are 8am-10pm',
    examples: [],
    frequency: 1,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: '3412 Sand Dunes',
  };

  test('returns empty string when no rules', () => {
    expect(buildLearnedRulesPrompt([], '7213 Nutria Run')).toBe('');
  });

  test('includes global rules for any property', () => {
    const result = buildLearnedRulesPrompt([globalRule], '7213 Nutria Run');
    expect(result).toContain('Answer directly without greeting');
  });

  test('includes matching property-specific rules', () => {
    const result = buildLearnedRulesPrompt([globalRule, propertyRule], '7213 Nutria Run');
    expect(result).toContain('Mention the garage parking option');
  });

  test('excludes non-matching property rules', () => {
    const result = buildLearnedRulesPrompt([globalRule, propertyRule, otherPropertyRule], '7213 Nutria Run');
    expect(result).not.toContain('pool hours');
  });

  test('only global rules when no propertyName provided', () => {
    const result = buildLearnedRulesPrompt([globalRule, propertyRule]);
    expect(result).toContain('Answer directly without greeting');
    expect(result).not.toContain('garage parking');
  });

  test('property-specific rules show property label not frequency', () => {
    const result = buildLearnedRulesPrompt([propertyRule], '7213 Nutria Run');
    expect(result).toContain('(for 7213 Nutria Run)');
    expect(result).not.toContain('observed in');
  });

  test('global rules show frequency label', () => {
    const result = buildLearnedRulesPrompt([globalRule], '7213 Nutria Run');
    expect(result).toContain('observed in 5 CS team edits');
  });

  test('rules without scope treated as global (backward compat)', () => {
    const legacyRule: LearnedRule = {
      ...globalRule,
      id: 'legacy',
      scope: undefined,
      correction: 'Legacy rule correction',
    };
    const result = buildLearnedRulesPrompt([legacyRule], 'Any Property');
    expect(result).toContain('Legacy rule correction');
  });
});
