import { describe, test, expect } from 'bun:test';
import {
  buildKBAnswerBlocks,
  buildKBDontKnowBlocks,
  buildKBAddAnswerModal,
  buildKBAddedConfirmBlocks,
  buildKBUndoneBlocks,
  buildKBConfirmedBlocks,
  buildKBCorrectedBlocks,
  buildKBCorrectionModal,
} from './kb-blocks.js';

describe('buildKBAnswerBlocks', () => {
  test('contains header, answer, and source', () => {
    const str = JSON.stringify(buildKBAnswerBlocks('Q', 'Password is ABC123', 'common.md > WiFi', 'knowledge-base/common.md'));
    expect(str).toContain('Knowledge Base Answer');
    expect(str).toContain('ABC123');
    expect(str).toContain('common.md > WiFi');
  });

  test('includes actions block with kb_confirm_answer action_id', () => {
    const blocks = buildKBAnswerBlocks('What is the WiFi password?', 'It is ABC123', 'common.md', 'knowledge-base/common.md');
    const str = JSON.stringify(blocks);
    expect(str).toContain('kb_confirm_answer');
  });

  test('includes actions block with kb_incorrect_answer action_id', () => {
    const blocks = buildKBAnswerBlocks('What is the WiFi password?', 'It is ABC123', 'common.md', 'knowledge-base/common.md');
    const str = JSON.stringify(blocks);
    expect(str).toContain('kb_incorrect_answer');
  });

  test('button values are valid JSON containing filePath', () => {
    const filePath = 'knowledge-base/properties/3412-san.md';
    const blocks = buildKBAnswerBlocks('What is check-out time?', 'Check-out is at 11am', 'property KB', filePath);
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const elements = (actionsBlock as { elements: Array<{ value?: string; action_id?: string }> }).elements;
    const confirmEl = elements.find((e) => e.action_id === 'kb_confirm_answer');
    const incorrectEl = elements.find((e) => e.action_id === 'kb_incorrect_answer');
    const confirmVal = JSON.parse(confirmEl?.value ?? '{}') as { filePath: string };
    const incorrectVal = JSON.parse(incorrectEl?.value ?? '{}') as { filePath: string };
    expect(confirmVal.filePath).toBe(filePath);
    expect(incorrectVal.filePath).toBe(filePath);
  });
});

describe('buildKBDontKnowBlocks', () => {
  test('contains kb_add_answer action_id', () => {
    expect(JSON.stringify(buildKBDontKnowBlocks('Q?', 'ts-123', []))).toContain('kb_add_answer');
  });

  test('button value contains question and threadTs', () => {
    const blocks = buildKBDontKnowBlocks('My question', 'ts-456', []);
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const elements = (actionsBlock as { elements: Array<{ value?: string }> }).elements;
    const val = JSON.parse(elements[0]?.value ?? '{}') as { question: string; threadTs: string };
    expect(val.question).toBe('My question');
    expect(val.threadTs).toBe('ts-456');
  });

  test('includes searched files context when array provided', () => {
    const blocks = buildKBDontKnowBlocks('Q?', 'ts-789', ['common.md', 'properties/3412-san.md']);
    const str = JSON.stringify(blocks);
    expect(str).toContain('Searched in');
    expect(str).toContain('common.md');
    expect(str).toContain('properties/3412-san.md');
  });

  test('works without searched files (empty array, no crash)', () => {
    const blocks = buildKBDontKnowBlocks('Q?', 'ts-000', []);
    const str = JSON.stringify(blocks);
    expect(str).not.toContain('Searched in');
    expect(blocks.length).toBeGreaterThan(0);
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

describe('buildKBConfirmedBlocks', () => {
  test('has no actions block and includes confirmed-by context', () => {
    const blocks = buildKBConfirmedBlocks('What is the WiFi?', 'Password is XYZ', 'common.md', 'U12345');
    const str = JSON.stringify(blocks);
    expect(blocks.find((b) => b.type === 'actions')).toBeUndefined();
    expect(str).toContain('Confirmed by');
    expect(str).toContain('U12345');
  });
});

describe('buildKBCorrectedBlocks', () => {
  test('has undo button with action_id kb_undo_add', () => {
    const blocks = buildKBCorrectedBlocks('Q?', 'Correct answer here.', 'knowledge-base/common.md', 'U99999');
    const str = JSON.stringify(blocks);
    expect(str).toContain('kb_undo_add');
    expect(str).toContain('Correction saved');
    expect(str).toContain('U99999');
  });
});

describe('buildKBCorrectionModal', () => {
  test('callback_id is kb_correction_modal and private_metadata is valid JSON with all fields', () => {
    const modal = buildKBCorrectionModal(
      'What time is check-out?',
      'Check-out is at noon.',
      'C123',
      'ts-001',
      'knowledge-base/common.md',
    ) as { callback_id: string; private_metadata: string };
    expect(modal.callback_id).toBe('kb_correction_modal');
    const meta = JSON.parse(modal.private_metadata) as {
      question: string;
      originalAnswer: string;
      channelId: string;
      messageTs: string;
      filePath: string;
    };
    expect(meta.question).toBe('What time is check-out?');
    expect(meta.originalAnswer).toBe('Check-out is at noon.');
    expect(meta.channelId).toBe('C123');
    expect(meta.messageTs).toBe('ts-001');
    expect(meta.filePath).toBe('knowledge-base/common.md');
  });
});
