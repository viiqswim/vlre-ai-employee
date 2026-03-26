import { describe, test, expect } from 'bun:test';
import {
  buildLearningConfirmationBlocks,
  buildLearningEditModal,
  buildLearningActionedBlocks,
} from './learning-blocks.js';
import type { LearnedRule } from '../pipeline/learned-rules.js';

const ruleProposal: LearnedRule = {
  id: 'rule-test-1-realtime',
  pattern: 'AI adds greeting',
  correction: 'Answer directly without a greeting',
  examples: [{ original: 'Hi there! Sure I can help...', edited: 'Sure, I can help...' }],
  frequency: 1,
  status: 'proposed',
  createdAt: new Date().toISOString(),
  type: 'rule',
  scope: 'global',
};

const knowledgeProposal: LearnedRule = {
  id: 'rule-test-2-realtime',
  pattern: 'WiFi password wrong',
  correction: 'The WiFi password is VLGuest2024',
  examples: [{ original: 'check the welcome packet', edited: 'WiFi password: VLGuest2024' }],
  frequency: 1,
  status: 'proposed',
  createdAt: new Date().toISOString(),
  type: 'knowledge',
  scope: '3412-SAN',
  kbFilePath: 'knowledge-base/properties/3412-san.md',
};

describe('buildLearningConfirmationBlocks', () => {
  test('rule-type: has 3 buttons with correct action_ids', () => {
    const blocks = buildLearningConfirmationBlocks(ruleProposal);
    const actions = blocks.find((b) => b.type === 'actions');
    expect(actions).toBeTruthy();
    const ids = (actions as any).elements.map((e: any) => e.action_id);
    expect(ids).toContain('confirm_learning');
    expect(ids).toContain('edit_learning');
    expect(ids).toContain('reject_learning');
  });

  test('rule-type: all button values are valid JSON under 2000 chars', () => {
    const blocks = buildLearningConfirmationBlocks(ruleProposal);
    const actions = blocks.find((b) => b.type === 'actions') as any;
    for (const btn of actions.elements) {
      expect(btn.value.length).toBeLessThan(2000);
      const parsed = JSON.parse(btn.value);
      expect(parsed.proposalId).toBe(ruleProposal.id);
    }
  });

  test('knowledge-type: shows KB file path in blocks', () => {
    const blocks = buildLearningConfirmationBlocks(knowledgeProposal);
    const blockText = JSON.stringify(blocks);
    expect(blockText).toContain('3412-san.md');
  });

  test('knowledge-type: shows 📚 header', () => {
    const blocks = buildLearningConfirmationBlocks(knowledgeProposal);
    const blockText = JSON.stringify(blocks);
    expect(blockText).toContain('📚');
  });

  test('rule-type: shows 🧠 header', () => {
    const blocks = buildLearningConfirmationBlocks(ruleProposal);
    const blockText = JSON.stringify(blocks);
    expect(blockText).toContain('🧠');
  });

  test('correction text appears in blocks', () => {
    const blocks = buildLearningConfirmationBlocks(ruleProposal);
    const blockText = JSON.stringify(blocks);
    expect(blockText).toContain('Answer directly without a greeting');
  });
});

describe('buildLearningEditModal', () => {
  test('has correct callback_id', () => {
    const modal = buildLearningEditModal(ruleProposal, 'C123', '12345.678') as any;
    expect(modal.callback_id).toBe('edit_learning_modal');
  });

  test('private_metadata is valid JSON under 3000 chars', () => {
    const modal = buildLearningEditModal(ruleProposal, 'C123', '12345.678') as any;
    expect(modal.private_metadata.length).toBeLessThan(3000);
    const parsed = JSON.parse(modal.private_metadata);
    expect(parsed.proposalId).toBe(ruleProposal.id);
    expect(parsed.channelId).toBe('C123');
    expect(parsed.messageTs).toBe('12345.678');
  });

  test('input block pre-filled with correction text', () => {
    const modal = buildLearningEditModal(ruleProposal, 'C123', '12345.678') as any;
    const input = modal.blocks.find((b: any) => b.type === 'input');
    expect(input.element.initial_value).toBe(ruleProposal.correction);
  });
});

describe('buildLearningActionedBlocks', () => {
  test('confirmed: shows checkmark and userId', () => {
    const blocks = buildLearningActionedBlocks('confirmed', 'U123');
    const text = JSON.stringify(blocks);
    expect(text).toContain('✅');
    expect(text).toContain('U123');
  });

  test('rejected: shows X and userId', () => {
    const blocks = buildLearningActionedBlocks('rejected', 'U456');
    const text = JSON.stringify(blocks);
    expect(text).toContain('❌');
    expect(text).toContain('U456');
  });

  test('no action buttons in actioned blocks', () => {
    const confirmedBlocks = buildLearningActionedBlocks('confirmed', 'U123');
    expect(confirmedBlocks.find((b) => b.type === 'actions')).toBeUndefined();
  });
});
