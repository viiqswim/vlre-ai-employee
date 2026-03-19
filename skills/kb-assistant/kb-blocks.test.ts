import { describe, test, expect } from 'bun:test';
import { buildKBAnswerBlocks, buildKBDontKnowBlocks, buildKBAddAnswerModal, buildKBAddedConfirmBlocks, buildKBUndoneBlocks } from './kb-blocks.js';

describe('buildKBAnswerBlocks', () => {
  test('contains header, answer, and source', () => {
    const str = JSON.stringify(buildKBAnswerBlocks('Q', 'Password is ABC123', 'common.md > WiFi'));
    expect(str).toContain('Knowledge Base Answer');
    expect(str).toContain('ABC123');
    expect(str).toContain('common.md > WiFi');
  });
});

describe('buildKBDontKnowBlocks', () => {
  test('contains kb_add_answer action_id', () => {
    expect(JSON.stringify(buildKBDontKnowBlocks('Q?', 'ts-123'))).toContain('kb_add_answer');
  });

  test('button value contains question and threadTs', () => {
    const blocks = buildKBDontKnowBlocks('My question', 'ts-456');
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const elements = (actionsBlock as { elements: Array<{ value?: string }> }).elements;
    const val = JSON.parse(elements[0]?.value ?? '{}') as { question: string; threadTs: string };
    expect(val.question).toBe('My question');
    expect(val.threadTs).toBe('ts-456');
  });
});

describe('buildKBAddAnswerModal', () => {
  test('has correct callback_id', () => {
    expect((buildKBAddAnswerModal('Q', 'C', 'ts') as { callback_id: string }).callback_id).toBe('kb_add_answer_modal');
  });

  test('private_metadata contains question, channelId, threadTs', () => {
    const modal = buildKBAddAnswerModal('My Q', 'C123', 'ts-001') as { private_metadata: string };
    const meta = JSON.parse(modal.private_metadata) as { question: string; channelId: string; threadTs: string };
    expect(meta.question).toBe('My Q');
    expect(meta.channelId).toBe('C123');
    expect(meta.threadTs).toBe('ts-001');
  });

  test('has answer_block input', () => {
    const modal = buildKBAddAnswerModal('Q', 'C', 'ts') as { blocks: Array<{ block_id?: string }> };
    expect(modal.blocks.find((b) => b.block_id === 'answer_block')).toBeDefined();
  });
});

describe('buildKBAddedConfirmBlocks', () => {
  test('contains undo button with kb_undo_add action_id', () => {
    const str = JSON.stringify(buildKBAddedConfirmBlocks('Q', 'knowledge-base/common.md', '### Entry\nText\n'));
    expect(str).toContain('kb_undo_add');
  });

  test('undo button value contains filePath', () => {
    const blocks = buildKBAddedConfirmBlocks('Q', 'knowledge-base/common.md', '### Entry\nText\n');
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const elements = (actionsBlock as { elements: Array<{ value?: string }> }).elements;
    const val = JSON.parse(elements[0]?.value ?? '{}') as { filePath: string };
    expect(val.filePath).toBe('knowledge-base/common.md');
  });
});

describe('buildKBUndoneBlocks', () => {
  test('contains removal confirmation text', () => {
    expect(JSON.stringify(buildKBUndoneBlocks())).toContain('removed from knowledge base');
  });
});