import { test, expect, mock, beforeAll, beforeEach } from 'bun:test';

const mockCallClaude = mock((_systemPrompt: string, _userMessage: string): Promise<string | null> => Promise.resolve(null));

mock.module('./real-time-analyzer.ts', () => ({
  callClaude: mockCallClaude,
  analyzeEditInBackground: mock(() => Promise.resolve({ ruleCreated: false, skipped: false })),
}));

let refineRuleWithClaude: (params: {
  originalPattern: string;
  originalCorrection: string;
  refinedText: string;
  conditions: string;
  scope: string;
}) => Promise<{ pattern: string; correction: string; scope: string } | null>;

beforeAll(async () => {
  const mod = await import('./rule-refiner.ts');
  refineRuleWithClaude = mod.refineRuleWithClaude;
});

beforeEach(() => {
  mockCallClaude.mockReset();
});

const baseParams = {
  originalPattern: 'AI adds greeting before answering',
  originalCorrection: 'Answer directly without Hi/Hey',
  refinedText: 'Skip all salutations and get straight to the point',
  conditions: '',
  scope: 'global',
};

test('refineRuleWithClaude success: valid JSON response returns pattern/correction/scope', async () => {
  mockCallClaude.mockImplementation(async () =>
    JSON.stringify({ pattern: 'p', correction: 'c', scope: 'global', skip: false, skipReason: null }),
  );

  const result = await refineRuleWithClaude(baseParams);

  expect(result).toEqual({ pattern: 'p', correction: 'c', scope: 'global' });
});

test('refineRuleWithClaude returns null when callClaude returns null', async () => {
  mockCallClaude.mockImplementation(async () => null);

  const result = await refineRuleWithClaude(baseParams);

  expect(result).toBeNull();
});

test('refineRuleWithClaude returns null when callClaude returns invalid JSON', async () => {
  mockCallClaude.mockImplementation(async () => 'not-json');

  const result = await refineRuleWithClaude(baseParams);

  expect(result).toBeNull();
});

test('refineRuleWithClaude returns null when skip is true', async () => {
  mockCallClaude.mockImplementation(async () =>
    JSON.stringify({ pattern: '', correction: '', scope: 'global', skip: true, skipReason: 'no change needed' }),
  );

  const result = await refineRuleWithClaude(baseParams);

  expect(result).toBeNull();
});
