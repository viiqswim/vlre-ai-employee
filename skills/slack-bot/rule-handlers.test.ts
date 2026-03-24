import { test, expect, beforeEach, spyOn } from 'bun:test';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import type { App } from '@slack/bolt';
import type { LearnedRule } from '../pipeline/learned-rules.ts';
import { invalidateCache, loadRules } from '../pipeline/rules-store.ts';

const RULES_FILE = 'data/learned-rules.json';
const RULES_TMP = 'data/learned-rules.tmp.json';

function writeTestRules(rules: LearnedRule[]): void {
  if (!existsSync('data')) mkdirSync('data', { recursive: true });
  writeFileSync(
    RULES_FILE,
    JSON.stringify({ rules, lastAnalyzed: null, version: 1 }, null, 2),
  );
}

function cleanup(): void {
  if (existsSync(RULES_FILE)) rmSync(RULES_FILE);
  if (existsSync(RULES_TMP)) rmSync(RULES_TMP);
  invalidateCache();
}

function makeRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: 'rule-test-1',
    pattern: 'AI adds greeting',
    correction: 'Answer directly without Hi/Hey',
    examples: [],
    frequency: 3,
    status: 'proposed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type AckFn = ((arg?: object) => Promise<void>) & (() => Promise<void>);
type ViewAckFn = (arg?: { response_action: string; errors: Record<string, string> }) => Promise<void>;

interface AckCall {
  args: unknown[];
}

function buildMockApp(): {
  app: App;
  actionHandlers: Map<string, (ctx: { ack: AckFn; body: unknown; client: unknown }) => Promise<void>>;
  viewHandlers: Map<string, (ctx: { ack: ViewAckFn; body: unknown; client: unknown; view: unknown }) => Promise<void>>;
  postMessageCalls: Array<{ channel: string; text: string }>;
  chatUpdateCalls: Array<{ channel: string; ts: string; blocks?: unknown; text: string }>;
  viewsOpenCalls: Array<{ trigger_id: string; view: unknown }>;
  postEphemeralCalls: Array<{ channel: string; user: string; text: string }>;
  client: unknown;
} {
  const actionHandlers = new Map<
    string,
    (ctx: { ack: AckFn; body: unknown; client: unknown }) => Promise<void>
  >();
  const viewHandlers = new Map<
    string,
    (ctx: { ack: ViewAckFn; body: unknown; client: unknown; view: unknown }) => Promise<void>
  >();
  const postMessageCalls: Array<{ channel: string; text: string }> = [];
  const chatUpdateCalls: Array<{ channel: string; ts: string; blocks?: unknown; text: string }> = [];
  const viewsOpenCalls: Array<{ trigger_id: string; view: unknown }> = [];
  const postEphemeralCalls: Array<{ channel: string; user: string; text: string }> = [];

  const client = {
    chat: {
      postMessage: async (params: { channel: string; text: string }) => {
        postMessageCalls.push(params);
        return { ok: true };
      },
      update: async (params: { channel: string; ts: string; blocks?: unknown; text: string }) => {
        chatUpdateCalls.push(params);
        return { ok: true };
      },
      postEphemeral: async (params: { channel: string; user: string; text: string }) => {
        postEphemeralCalls.push(params);
        return { ok: true };
      },
    },
    views: {
      open: async (params: { trigger_id: string; view: unknown }) => {
        viewsOpenCalls.push(params);
        return { ok: true };
      },
    },
  };

  const app = {
    action: (
      actionId: string,
      handler: (ctx: { ack: AckFn; body: unknown; client: unknown }) => Promise<void>,
    ) => {
      actionHandlers.set(actionId, handler);
    },
    view: (
      viewId: string,
      handler: (ctx: { ack: ViewAckFn; body: unknown; client: unknown; view: unknown }) => Promise<void>,
    ) => {
      viewHandlers.set(viewId, handler);
    },
  } as unknown as App;

  return { app, actionHandlers, viewHandlers, postMessageCalls, chatUpdateCalls, viewsOpenCalls, postEphemeralCalls, client: client as unknown };
}

function buildSlackErrorClient() {
  return {
    chat: {
      postMessage: async () => ({ ok: true }),
      update: async () => {
        throw Object.assign(
          new Error('An API error occurred: message_not_found'),
          { code: 'slack_webapi_platform_error', data: { ok: false, error: 'message_not_found' } },
        );
      },
      postEphemeral: async () => ({ ok: true }),
    },
    views: {
      open: async () => ({ ok: true }),
    },
  };
}

beforeEach(() => {
  cleanup();
});

test('approve_rule: confirms a proposed rule and updates Slack message', async () => {
  const rule = makeRule({ id: 'rule-approve-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers, chatUpdateCalls } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('approve_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-approve-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: {
      ts: '1234567890.000',
      blocks: [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'approve_rule',
              value: JSON.stringify({ ruleId: 'rule-approve-1' }),
            },
          ],
        },
      ],
    },
  };

  await handler({ ack, body, client: (buildMockApp() as unknown as { client: unknown }).client });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-approve-1');
  expect(updated?.status).toBe('confirmed');
  expect(ackCalls.length).toBe(1);
});

test('approve_rule: idempotent — approving an already-confirmed rule does not double-write', async () => {
  const rule = makeRule({ id: 'rule-idem-1', status: 'confirmed', confirmedAt: '2026-01-01T00:00:00.000Z' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('approve_rule')!;
  const ack = (async () => {}) as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-idem-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  await handler({ ack, body, client: buildMockApp().client as unknown });
  await handler({ ack, body, client: buildMockApp().client as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-idem-1');
  expect(updated?.status).toBe('confirmed');
});

test('add_rule_modal: rejects submission when pattern is empty', async () => {
  const { app, viewHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = viewHandlers.get('add_rule_modal')!;
  expect(handler).toBeDefined();

  const ackCalls: Array<{ arg?: unknown }> = [];
  const ack = (async (arg?: unknown) => { ackCalls.push({ arg }); }) as ViewAckFn;

  const body = {
    user: { id: 'U456' },
    view: {
      state: {
        values: {
          pattern_block: { pattern_input: { value: '' } },
          correction_block: { correction_input: { value: 'Answer directly' } },
        },
      },
    },
  };

  await handler({ ack, body, client: buildMockApp().client as unknown, view: body.view });

  expect(ackCalls.length).toBe(1);
  const ackArg = ackCalls[0]?.arg as { response_action?: string; errors?: Record<string, string> } | undefined;
  expect(ackArg?.response_action).toBe('errors');
  expect(ackArg?.errors?.['pattern_block']).toBeDefined();
});

test('remove_rule_modal: deactivates multiple rules', async () => {
  const rule1 = makeRule({ id: 'rule-rm-1', status: 'confirmed' });
  const rule2 = makeRule({ id: 'rule-rm-2', status: 'confirmed', pattern: 'AI adds signature' });
  const rule3 = makeRule({ id: 'rule-rm-3', status: 'confirmed', pattern: 'AI uses formal tone' });
  writeTestRules([rule1, rule2, rule3]);
  invalidateCache();

  process.env['SLACK_CHANNEL_ID'] = '';

  const { app, viewHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = viewHandlers.get('remove_rule_modal')!;
  const ack = (async () => {}) as ViewAckFn;

  const body = {
    user: { id: 'U789' },
    view: {
      state: {
        values: {
          remove_rules_block: {
            rules_to_remove: {
              selected_options: [{ value: 'rule-rm-1' }, { value: 'rule-rm-2' }],
            },
          },
        },
      },
    },
  };

  await handler({ ack, body, client: buildMockApp().client as unknown, view: body.view });

  invalidateCache();
  const rules = loadRules();
  expect(rules.find((r) => r.id === 'rule-rm-1')?.status).toBe('rejected');
  expect(rules.find((r) => r.id === 'rule-rm-2')?.status).toBe('rejected');
  expect(rules.find((r) => r.id === 'rule-rm-3')?.status).toBe('confirmed');
});

test('reject_rule: sets rule status to rejected', async () => {
  const rule = makeRule({ id: 'rule-rej-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('reject_rule')!;
  expect(handler).toBeDefined();

  const ack = (async () => {}) as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-rej-1' }) }],
    user: { id: 'U999' },
    channel: { id: 'C999' },
    message: {
      ts: '1234567890.000',
      blocks: [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'reject_rule',
              value: JSON.stringify({ ruleId: 'rule-rej-1' }),
            },
          ],
        },
      ],
    },
  };

  await handler({ ack, body, client: buildMockApp().client as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-rej-1');
  expect(updated?.status).toBe('rejected');
});

test('refine_rule: opens modal with refine_rule_modal callback_id and sets rule to pending_refinement', async () => {
  const rule = makeRule({ id: 'rule-refine-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers, viewsOpenCalls, client } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('refine_rule')!;
  expect(handler).toBeDefined();

  const ack = (async () => {}) as AckFn;
  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-refine-1' }) }],
    user: { id: 'U123' },
    trigger_id: 'trigger-abc-123',
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  await handler({ ack, body, client });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-refine-1');

  expect(viewsOpenCalls.length).toBe(1);
  const openCall = viewsOpenCalls[0]!;
  expect(openCall.trigger_id).toBe('trigger-abc-123');
  const view = openCall.view as { callback_id?: string };
  expect(view.callback_id).toBe('refine_rule_modal');
  expect(updated?.status).toBe('pending_refinement');
});

test('refine_rule: non-existent rule — views.open NOT called', async () => {
  const { app, actionHandlers, viewsOpenCalls, client } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('refine_rule')!;
  expect(handler).toBeDefined();

  const ack = (async () => {}) as AckFn;
  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'nonexistent-rule-xyz' }) }],
    user: { id: 'U123' },
    trigger_id: 'trigger-xyz',
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  await handler({ ack, body, client });

  expect(viewsOpenCalls.length).toBe(0);
});

test('accept_refined_rule: confirms rule and calls chat.update', async () => {
  const rule = makeRule({ id: 'rule-accept-refined-1', status: 'pending_refinement' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers, chatUpdateCalls, client } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('accept_refined_rule')!;
  expect(handler).toBeDefined();

  const ack = (async () => {}) as AckFn;
  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-accept-refined-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  await handler({ ack, body, client });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-accept-refined-1');

  expect(updated?.status).toBe('confirmed');
  expect(updated?.confirmedAt).toBeDefined();
  expect(chatUpdateCalls.length).toBe(1);
});

test('reject_refined_rule: rejects rule and calls chat.update', async () => {
  const rule = makeRule({ id: 'rule-reject-refined-1', status: 'pending_refinement' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers, chatUpdateCalls, client } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('reject_refined_rule')!;
  expect(handler).toBeDefined();

  const ack = (async () => {}) as AckFn;
  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-reject-refined-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  await handler({ ack, body, client });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-reject-refined-1');

  expect(updated?.status).toBe('rejected');
  expect(chatUpdateCalls.length).toBe(1);
});

test('approve_rule: rule is confirmed even when chat.update throws message_not_found', async () => {
  const rule = makeRule({ id: 'rule-approve-err-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('approve_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-approve-err-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: {
      ts: '1234567890.000',
      blocks: [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'approve_rule',
              value: JSON.stringify({ ruleId: 'rule-approve-err-1' }),
            },
          ],
        },
      ],
    },
  };

  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  await handler({ ack, body, client: buildSlackErrorClient() as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-approve-err-1');

  expect(updated?.status).toBe('confirmed');
  expect(ackCalls.length).toBe(1);
  expect(warnSpy.mock.calls.some((call) => {
    const msg = String(call[0]);
    return msg.includes('approve_rule') && msg.includes('(non-blocking)');
  })).toBe(true);
  warnSpy.mockRestore();
});

test('reject_rule: rule is rejected even when chat.update throws message_not_found', async () => {
  const rule = makeRule({ id: 'rule-rej-err-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('reject_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-rej-err-1' }) }],
    user: { id: 'U999' },
    channel: { id: 'C999' },
    message: {
      ts: '1234567890.000',
      blocks: [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'reject_rule',
              value: JSON.stringify({ ruleId: 'rule-rej-err-1' }),
            },
          ],
        },
      ],
    },
  };

  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  await handler({ ack, body, client: buildSlackErrorClient() as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-rej-err-1');

  expect(updated?.status).toBe('rejected');
  expect(ackCalls.length).toBe(1);
  expect(warnSpy.mock.calls.some((call) => {
    const msg = String(call[0]);
    return msg.includes('reject_rule') && msg.includes('(non-blocking)');
  })).toBe(true);
  warnSpy.mockRestore();
});

test('refine_rule: rule set to pending_refinement even when chat.update throws message_not_found', async () => {
  const rule = makeRule({ id: 'rule-refine-err-1', status: 'proposed' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('refine_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-refine-err-1' }) }],
    user: { id: 'U123' },
    trigger_id: 'trigger-err-123',
    channel: { id: 'C999' },
    message: {
      ts: '1234567890.000',
      blocks: [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'refine_rule',
              value: JSON.stringify({ ruleId: 'rule-refine-err-1' }),
            },
          ],
        },
      ],
    },
  };

  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  await handler({ ack, body, client: buildSlackErrorClient() as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-refine-err-1');

  expect(updated?.status).toBe('pending_refinement');
  expect(ackCalls.length).toBe(1);
  expect(warnSpy.mock.calls.some((call) => {
    const msg = String(call[0]);
    return msg.includes('refine_rule') && msg.includes('(non-blocking)');
  })).toBe(true);
  warnSpy.mockRestore();
});

test('accept_refined_rule: rule is confirmed even when chat.update throws message_not_found', async () => {
  const rule = makeRule({ id: 'rule-accept-err-1', status: 'pending_refinement' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('accept_refined_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-accept-err-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  await handler({ ack, body, client: buildSlackErrorClient() as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-accept-err-1');

  expect(updated?.status).toBe('confirmed');
  expect(updated?.confirmedAt).toBeDefined();
  expect(ackCalls.length).toBe(1);
  expect(warnSpy.mock.calls.some((call) => {
    const msg = String(call[0]);
    return msg.includes('accept_refined_rule') && msg.includes('(non-blocking)');
  })).toBe(true);
  warnSpy.mockRestore();
});

test('reject_refined_rule: rule is rejected even when chat.update throws message_not_found', async () => {
  const rule = makeRule({ id: 'rule-reject-err-1', status: 'pending_refinement' });
  writeTestRules([rule]);
  invalidateCache();

  const { app, actionHandlers } = buildMockApp();
  const { registerRuleHandlers } = await import('./rule-handlers.ts');
  registerRuleHandlers(app);

  const handler = actionHandlers.get('reject_refined_rule')!;
  expect(handler).toBeDefined();

  const ackCalls: AckCall[] = [];
  const ack = (async (...args: unknown[]) => { ackCalls.push({ args }); }) as unknown as AckFn;

  const body = {
    actions: [{ value: JSON.stringify({ ruleId: 'rule-reject-err-1' }) }],
    user: { id: 'U123' },
    channel: { id: 'C999' },
    message: { ts: '1234567890.000', blocks: [] },
  };

  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  await handler({ ack, body, client: buildSlackErrorClient() as unknown });

  invalidateCache();
  const rules = loadRules();
  const updated = rules.find((r) => r.id === 'rule-reject-err-1');

  expect(updated?.status).toBe('rejected');
  expect(ackCalls.length).toBe(1);
  expect(warnSpy.mock.calls.some((call) => {
    const msg = String(call[0]);
    return msg.includes('reject_refined_rule') && msg.includes('(non-blocking)');
  })).toBe(true);
  warnSpy.mockRestore();
});
