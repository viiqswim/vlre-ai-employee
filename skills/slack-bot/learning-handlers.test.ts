import { describe, test, expect, mock, beforeEach, beforeAll } from 'bun:test';
import type { App } from '@slack/bolt';
import type { LearnedRule } from '../pipeline/learned-rules.ts';

const mockLoadRules = mock((): LearnedRule[] => []);
const mockUpdateRule = mock(async (_id: string, _update: Partial<LearnedRule>) => ({} as LearnedRule));
const mockInvalidateCache = mock(() => {});

mock.module('../pipeline/rules-store.js', () => ({
  loadRules: mockLoadRules,
  updateRule: mockUpdateRule,
  invalidateCache: mockInvalidateCache,
}));

const mockAppendToKB = mock(async (_filePath: string, _entryText: string) => ({
  success: true,
  filePath: 'test.md',
  appendedText: 'appended text\n',
  lineStart: 42,
}));

mock.module('../kb-assistant/kb-writer.js', () => ({
  appendToKB: mockAppendToKB,
}));

const mockBuildLearningConfirmationBlocks = mock((_rule: unknown) => [] as object[]);
const mockBuildLearningActionedBlocks = mock((_status: string, _userId: string) => [] as object[]);
const mockBuildLearningEditModal = mock(
  (_rule: unknown, _channelId: string, _messageTs: string) => ({
    type: 'modal',
    callback_id: 'edit_learning_modal',
    title: { type: 'plain_text', text: 'Edit Learning' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [],
    private_metadata: '',
  }),
);

mock.module('../slack-blocks/learning-blocks.js', () => ({
  buildLearningConfirmationBlocks: mockBuildLearningConfirmationBlocks,
  buildLearningActionedBlocks: mockBuildLearningActionedBlocks,
  buildLearningEditModal: mockBuildLearningEditModal,
}));

const mockAppendAuditLog = mock((_entry: object) => {});

mock.module('./handlers.js', () => ({
  appendAuditLog: mockAppendAuditLog,
}));

let registerLearningHandlers: (app: App) => void;

beforeAll(async () => {
  const mod = await import('./learning-handlers.ts');
  registerLearningHandlers = mod.registerLearningHandlers;
});

type AckFn = () => Promise<void>;
type ActionHandlerCtx = { ack: AckFn; body: unknown; client: unknown };
type ViewHandlerCtx = { ack: AckFn; body: unknown; client: unknown; view: unknown };

function createFakeApp() {
  const actionHandlers = new Map<string, (ctx: ActionHandlerCtx) => Promise<void>>();
  const viewHandlers = new Map<string, (ctx: ViewHandlerCtx) => Promise<void>>();

  const app = {
    action: (actionId: string, handler: (ctx: ActionHandlerCtx) => Promise<void>) => {
      actionHandlers.set(actionId, handler);
    },
    view: (viewId: string, handler: (ctx: ViewHandlerCtx) => Promise<void>) => {
      viewHandlers.set(viewId, handler);
    },
  } as unknown as App;

  return {
    app,
    getActionHandler: (id: string) => actionHandlers.get(id),
    getViewHandler: (id: string) => viewHandlers.get(id),
  };
}

function createFakeClient() {
  return {
    chat: {
      update: mock(async () => ({ ok: true })),
      postEphemeral: mock(async () => ({ ok: true })),
    },
    views: {
      open: mock(async () => ({ ok: true })),
    },
  };
}

function makeRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: 'rule-test-1',
    pattern: 'AI adds greeting',
    correction: 'Answer directly without Hi/Hey',
    examples: [],
    frequency: 1,
    status: 'proposed',
    createdAt: '2026-01-01T00:00:00.000Z',
    type: 'rule',
    ...overrides,
  };
}

function createActionBody(
  proposalId: string,
  userId = 'U123',
  channelId = 'C456',
  messageTs = '12345.678',
) {
  return {
    user: { id: userId },
    channel: { id: channelId },
    message: { ts: messageTs },
    trigger_id: 'trigger-123',
    actions: [{ value: JSON.stringify({ proposalId }) }],
  };
}

beforeEach(() => {
  mockLoadRules.mockReset();
  mockUpdateRule.mockReset();
  mockInvalidateCache.mockReset();
  mockAppendToKB.mockReset();
  mockBuildLearningConfirmationBlocks.mockReset();
  mockBuildLearningActionedBlocks.mockReset();
  mockBuildLearningEditModal.mockReset();
  mockAppendAuditLog.mockReset();

  mockLoadRules.mockReturnValue([]);
  mockUpdateRule.mockImplementation(async () => ({} as LearnedRule));
  mockAppendToKB.mockImplementation(async () => ({
    success: true,
    filePath: 'test.md',
    appendedText: 'appended text\n',
    lineStart: 42,
  }));
  mockBuildLearningConfirmationBlocks.mockReturnValue([]);
  mockBuildLearningActionedBlocks.mockReturnValue([]);
  mockBuildLearningEditModal.mockReturnValue({
    type: 'modal',
    callback_id: 'edit_learning_modal',
    title: { type: 'plain_text', text: 'Edit Learning' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [],
    private_metadata: '',
  });
});

describe('confirm_learning', () => {
  test('rule-type: calls updateRule with confirmed status, does NOT call appendToKB', async () => {
    const rule = makeRule({ id: 'rule-c1', type: 'rule' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('confirm_learning');
    expect(handler).toBeDefined();

    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-c1'), client });

    expect(ack).toHaveBeenCalled();
    expect(mockUpdateRule).toHaveBeenCalledWith(
      'rule-c1',
      expect.objectContaining({ status: 'confirmed' }),
    );
    expect(mockAppendToKB).not.toHaveBeenCalled();
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(client.chat.update).toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'learning_confirmed', proposalId: 'rule-c1' }),
    );
  });

  test('knowledge-type: calls appendToKB then updateRule with confirmed + kbAppendedText', async () => {
    const rule = makeRule({
      id: 'rule-c2',
      type: 'knowledge',
      correction: 'Pool closes at 9pm',
      kbFilePath: 'knowledge-base/properties/3412-san.md',
    });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('confirm_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-c2'), client });

    expect(mockAppendToKB).toHaveBeenCalledWith(
      'knowledge-base/properties/3412-san.md',
      'Pool closes at 9pm',
    );
    expect(mockUpdateRule).toHaveBeenCalledWith(
      'rule-c2',
      expect.objectContaining({ status: 'confirmed', kbAppendedText: expect.any(String) }),
    );
  });

  test('already-confirmed: posts ephemeral, does NOT call updateRule', async () => {
    const rule = makeRule({ id: 'rule-c3', status: 'confirmed' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('confirm_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-c3'), client });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  test('already-rejected: posts ephemeral, does NOT call updateRule', async () => {
    const rule = makeRule({ id: 'rule-c4', status: 'rejected' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('confirm_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-c4'), client });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  test('unknown proposalId: does NOT call updateRule or chat.update', async () => {
    mockLoadRules.mockReturnValue([]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('confirm_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('nonexistent-id'), client });

    expect(mockUpdateRule).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
  });
});

describe('reject_learning', () => {
  test('calls updateRule with rejected, does NOT call appendToKB', async () => {
    const rule = makeRule({ id: 'rule-r1' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('reject_learning');
    expect(handler).toBeDefined();

    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-r1'), client });

    expect(ack).toHaveBeenCalled();
    expect(mockUpdateRule).toHaveBeenCalledWith('rule-r1', { status: 'rejected' });
    expect(mockAppendToKB).not.toHaveBeenCalled();
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(client.chat.update).toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'learning_rejected', proposalId: 'rule-r1' }),
    );
  });

  test('already-rejected: posts ephemeral, does NOT call updateRule', async () => {
    const rule = makeRule({ id: 'rule-r2', status: 'rejected' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('reject_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-r2'), client });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  test('already-confirmed: posts ephemeral, does NOT call updateRule', async () => {
    const rule = makeRule({ id: 'rule-r3', status: 'confirmed' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('reject_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-r3'), client });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });
});

describe('edit_learning', () => {
  test('opens modal via views.open with correct args', async () => {
    const rule = makeRule({ id: 'rule-e1' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('edit_learning');
    expect(handler).toBeDefined();

    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-e1', 'U123', 'C456', '12345.678'), client });

    expect(ack).toHaveBeenCalled();
    expect(client.views.open).toHaveBeenCalled();
    expect(mockBuildLearningEditModal).toHaveBeenCalledWith(rule, 'C456', '12345.678');
  });

  test('already-handled: posts ephemeral, does NOT open modal', async () => {
    const rule = makeRule({ id: 'rule-e2', status: 'confirmed' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('edit_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('rule-e2'), client });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(client.views.open).not.toHaveBeenCalled();
  });

  test('unknown proposalId: does NOT open modal', async () => {
    mockLoadRules.mockReturnValue([]);

    const { app, getActionHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getActionHandler('edit_learning');
    const client = createFakeClient();
    const ack = mock(async () => {});

    await handler!({ ack, body: createActionBody('nonexistent-id'), client });

    expect(client.views.open).not.toHaveBeenCalled();
  });
});

describe('edit_learning_modal', () => {
  test('updates correction text and re-posts confirmation blocks', async () => {
    const rule = makeRule({ id: 'rule-m1', correction: 'old text' });
    const updatedRule = makeRule({ id: 'rule-m1', correction: 'new refined text' });
    mockLoadRules.mockReturnValueOnce([rule]).mockReturnValueOnce([updatedRule]);

    const { app, getViewHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getViewHandler('edit_learning_modal');
    expect(handler).toBeDefined();

    const client = createFakeClient();
    const ack = mock(async () => {});

    const view = {
      private_metadata: JSON.stringify({
        proposalId: 'rule-m1',
        channelId: 'C456',
        messageTs: '12345.678',
      }),
      state: {
        values: {
          learning_text_block: {
            learning_text_input: { value: 'new refined text' },
          },
        },
      },
    };

    await handler!({ ack, body: { user: { id: 'U123' } }, client, view });

    expect(ack).toHaveBeenCalled();
    expect(mockUpdateRule).toHaveBeenCalledWith('rule-m1', { correction: 'new refined text' });
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(client.chat.update).toHaveBeenCalled();
    expect(mockBuildLearningConfirmationBlocks).toHaveBeenCalledWith(updatedRule);
  });

  test('already-handled: posts ephemeral, does NOT call updateRule', async () => {
    const rule = makeRule({ id: 'rule-m2', status: 'confirmed' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getViewHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getViewHandler('edit_learning_modal');
    const client = createFakeClient();
    const ack = mock(async () => {});

    const view = {
      private_metadata: JSON.stringify({
        proposalId: 'rule-m2',
        channelId: 'C456',
        messageTs: '12345.678',
      }),
      state: {
        values: {
          learning_text_block: {
            learning_text_input: { value: 'some refined text' },
          },
        },
      },
    };

    await handler!({ ack, body: { user: { id: 'U123' } }, client, view });

    expect(client.chat.postEphemeral).toHaveBeenCalled();
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  test('empty refinedText: returns early without calling updateRule', async () => {
    const rule = makeRule({ id: 'rule-m3' });
    mockLoadRules.mockReturnValue([rule]);

    const { app, getViewHandler } = createFakeApp();
    registerLearningHandlers(app);

    const handler = getViewHandler('edit_learning_modal');
    const client = createFakeClient();
    const ack = mock(async () => {});

    const view = {
      private_metadata: JSON.stringify({
        proposalId: 'rule-m3',
        channelId: 'C456',
        messageTs: '12345.678',
      }),
      state: {
        values: {
          learning_text_block: {
            learning_text_input: { value: '   ' }, // whitespace only → trims to empty
          },
        },
      },
    };

    await handler!({ ack, body: { user: { id: 'U123' } }, client, view });

    expect(mockUpdateRule).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
  });
});
