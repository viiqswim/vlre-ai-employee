import { describe, test, expect, mock, beforeEach, beforeAll } from 'bun:test';
import type { LearnedRule } from './learned-rules.ts';
import type { AnalysisResult } from './real-time-analyzer.ts';

const mockAddRule = mock(async (_rule: LearnedRule) => {});
const mockUpdateRule = mock(async (_id: string, _update: Partial<LearnedRule>) => ({} as LearnedRule));
const mockInvalidateCache = mock(() => {});
const mockLoadRules = mock(() => [] as LearnedRule[]);
const mockGetConfirmedRules = mock(() => [] as LearnedRule[]);

// mock.module MUST be called before the module under test is imported in Bun
mock.module('./rules-store.ts', () => ({
  addRule: mockAddRule,
  updateRule: mockUpdateRule,
  invalidateCache: mockInvalidateCache,
  loadRules: mockLoadRules,
  getConfirmedRules: mockGetConfirmedRules,
  saveRules: mock(async () => {}),
}));

// Dynamic import ensures the mock above is in effect when real-time-analyzer loads rules-store
let analyzeEditInBackground: (params: {
  originalDraft: string;
  editedText: string;
  propertyName: string;
  onRuleCreated?: (rule: LearnedRule) => Promise<void>;
}) => Promise<AnalysisResult>;

beforeAll(async () => {
  const mod = await import('./real-time-analyzer.ts');
  analyzeEditInBackground = mod.analyzeEditInBackground;
});

const mockFetch = mock(async (_url: string, _opts?: RequestInit) => {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pattern: 'AI uses numbered lists',
              correction: 'Write in flowing prose not numbered lists',
              scope: 'global',
              skip: false,
              skipReason: null,
            }),
          },
        },
      ],
    }),
    { status: 200 },
  );
});

beforeEach(() => {
  mockAddRule.mockReset();
  mockUpdateRule.mockReset();
  mockInvalidateCache.mockReset();
  mockLoadRules.mockReset();
  mockGetConfirmedRules.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  process.env['OPENROUTER_API_KEY'] = 'sk-or-test-key';
});

describe('analyzeEditInBackground', () => {
  test('skips trivial edits with <10% delta', async () => {
    const result = await analyzeEditInBackground({
      originalDraft: 'The wifi password is abc123',
      editedText: 'The wifi password is abc1234',
      propertyName: 'Test Property',
    });
    expect(result.skipped).toBe(true);
    expect(result.ruleCreated).toBe(false);
    expect(mockAddRule).not.toHaveBeenCalled();
  });

  test('skips empty originalDraft', async () => {
    const result = await analyzeEditInBackground({
      originalDraft: '',
      editedText: 'Some edited text here',
      propertyName: 'Test Property',
    });
    expect(result.skipped).toBe(true);
    expect(result.ruleCreated).toBe(false);
  });

  test('skips empty editedText', async () => {
    const result = await analyzeEditInBackground({
      originalDraft: 'Some original draft text here',
      editedText: '',
      propertyName: 'Test Property',
    });
    expect(result.skipped).toBe(true);
    expect(result.ruleCreated).toBe(false);
  });

  test('catches errors and returns error result without throwing', async () => {
    mockAddRule.mockImplementation(async () => {
      throw new Error('disk full');
    });

    const overrideFetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pattern: 'Test pattern',
                    correction: 'Test correction',
                    scope: 'global',
                    skip: false,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    global.fetch = overrideFetch as unknown as typeof fetch;

    const original = 'WiFi info at the property.';
    const edited =
      'WiFi is GuestNetwork, password abc123. Router is in the living room closet if you need to restart it.';
    const result = await analyzeEditInBackground({
      originalDraft: original,
      editedText: edited,
      propertyName: 'Test Property',
    });

    expect(result.ruleCreated).toBe(false);
    expect(result.error).toBeDefined();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  test('handles DUPLICATE_PATTERN by updating frequency', async () => {
    const existingRule: LearnedRule = {
      id: 'existing-rule-1',
      pattern: 'AI uses numbered lists',
      correction: 'Write in flowing prose not numbered lists',
      examples: [],
      frequency: 2,
      status: 'confirmed',
      createdAt: '2026-01-01T00:00:00.000Z',
      scope: 'global',
    };

    mockAddRule.mockImplementation(async () => {
      throw new Error('DUPLICATE_PATTERN');
    });
    mockLoadRules.mockReturnValue([existingRule]);
    mockUpdateRule.mockImplementation(async (_id: string, update: Partial<LearnedRule>) => ({
      ...existingRule,
      ...update,
    }));

    const original = '1. WiFi: GuestNet\n2. Code: 4829\n3. Park: driveway';
    const edited = 'WiFi is GuestNet and password is abc123. Door code 4829. Parking is in the driveway.';
    const result = await analyzeEditInBackground({
      originalDraft: original,
      editedText: edited,
      propertyName: 'Test Property',
    });

    expect(mockUpdateRule).toHaveBeenCalledWith(existingRule.id, expect.objectContaining({ frequency: 3 }));
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
  });
});

describe('callClaude', () => {
  test('logs auth-specific message for 401 response', async () => {
    const { callClaude } = await import('./real-time-analyzer.ts');
    const errorSpy = mock((msg: string) => {});
    const originalError = console.error;
    console.error = errorSpy as unknown as typeof console.error;

    const fetch401 = mock(
      async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
    );
    global.fetch = fetch401 as unknown as typeof fetch;
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test-key';

    const result = await callClaude('system prompt', 'user message');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    const callArgs = errorSpy.mock.calls[0]?.[0];
    expect(callArgs).toContain('authentication failed');

    console.error = originalError;
  });

  test('logs generic message for 500 response', async () => {
    const { callClaude } = await import('./real-time-analyzer.ts');
    const errorSpy = mock((msg: string) => {});
    const originalError = console.error;
    console.error = errorSpy as unknown as typeof console.error;

    const fetch500 = mock(
      async () =>
        new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          statusText: 'Internal Server Error',
        }),
    );
    global.fetch = fetch500 as unknown as typeof fetch;
    process.env['OPENROUTER_API_KEY'] = 'sk-or-test-key';

    const result = await callClaude('system prompt', 'user message');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    const callArgs = errorSpy.mock.calls[0]?.[0];
    expect(callArgs).not.toContain('authentication failed');
    expect(callArgs).toContain('500');

    console.error = originalError;
  });
});

describe('analyzeEditInBackground — proposed status and type', () => {
  test('new rule has status: proposed (not confirmed)', async () => {
    const original = '1. WiFi: GuestNet\n2. Code: 4829\n3. Park: driveway';
    const edited =
      'WiFi is GuestNet, password is abc123. Door code 4829. Parking is in the driveway.';

    const result = await analyzeEditInBackground({
      originalDraft: original,
      editedText: edited,
      propertyName: 'Test Property',
    });

    expect(result.proposed).toBe(true);
    expect(result.rule?.status).toBe('proposed');

    expect(mockAddRule).toHaveBeenCalledTimes(1);
    const addedRule = mockAddRule.mock.calls[0]?.[0] as LearnedRule;
    expect(addedRule.status).toBe('proposed');
  });

  test('new rule has no confirmedAt field', async () => {
    const original = '1. WiFi: GuestNet\n2. Code: 4829\n3. Park: driveway';
    const edited =
      'WiFi is GuestNet, password is abc123. Door code 4829. Parking is in the driveway.';

    const result = await analyzeEditInBackground({
      originalDraft: original,
      editedText: edited,
      propertyName: 'Test Property',
    });

    expect(result.rule?.confirmedAt).toBeUndefined();

    const addedRule = mockAddRule.mock.calls[0]?.[0] as LearnedRule;
    expect(addedRule.confirmedAt).toBeUndefined();
  });

  test('type is set to rule when Claude returns type=rule', async () => {
    const ruleFetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    type: 'rule',
                    pattern: 'AI adds formal greeting',
                    correction: 'Do not add formal greetings',
                    scope: 'global',
                    skip: false,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    global.fetch = ruleFetch as unknown as typeof fetch;

    const original = '1. WiFi: GuestNet\n2. Code: 4829\n3. Park: driveway';
    const edited =
      'WiFi is GuestNet, password is abc123. Door code 4829. Parking is in the driveway.';

    const result = await analyzeEditInBackground({
      originalDraft: original,
      editedText: edited,
      propertyName: 'Test Property',
    });

    expect(result.rule?.type).toBe('rule');

    global.fetch = mockFetch as unknown as typeof fetch;
  });

  test('skips when original and edited text are same after normalizing whitespace/case', async () => {
    const result = await analyzeEditInBackground({
      originalDraft: 'The wifi password is ABC123',
      editedText: 'the wifi password is abc123',
      propertyName: 'Test Property',
    });

    expect(result.skipped).toBe(true);
    expect(result.ruleCreated).toBe(false);
    expect(mockAddRule).not.toHaveBeenCalled();
  });
});
