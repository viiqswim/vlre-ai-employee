import { test, expect } from 'bun:test';
import type { KnownBlock } from '@slack/types';
import {
  buildWeeklyRecapBlocks,
  buildRuleActionedRecapBlocks,
  buildAddRuleModal,
  buildRemoveRuleModal,
} from './recap-blocks';
import type { WeeklyAnalysisResult } from '../pipeline/edit-analyzer';
import type { LearnedRule } from '../pipeline/learned-rules';

function makeRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: 'rule-test-1',
    pattern: 'AI adds greeting before answering',
    correction: 'Answer directly without starting with Hi/Hey',
    examples: [{ original: 'Hi! Here is the answer.', edited: 'Here is the answer.' }],
    frequency: 3,
    status: 'proposed',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<WeeklyAnalysisResult> = {}): WeeklyAnalysisResult {
  return {
    totalEdits: 0,
    newProposedRules: [],
    existingConfirmedRules: [],
    existingRejectedRules: [],
    recapMarkdownPath: null,
    ...overrides,
  };
}

type ModalView = {
  type: string;
  callback_id: string;
  title?: { text: string };
  submit?: { text: string };
  close?: { text: string };
  blocks?: Array<{
    type: string;
    block_id?: string;
    text?: { text: string };
    element?: { type?: string; action_id?: string; options?: Array<{ text: { text: string }; value: string }> };
  }>;
};

test('buildWeeklyRecapBlocks header contains today date string', () => {
  const result = makeResult();
  const blocks = buildWeeklyRecapBlocks(result, []);
  const header = blocks.find(b => b.type === 'header');
  expect(header).toBeDefined();
  if (header?.type === 'header') {
    expect(header.text?.text).toContain('📊 Weekly Rules Recap');
    const year = new Date().getFullYear().toString();
    expect(header.text?.text).toContain(year);
  }
});

test('Scenario 1: recap with 3 proposed rules has approve_rule and reject_rule action blocks', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const rule2 = makeRule({ id: 'rule-2' });
  const rule3 = makeRule({ id: 'rule-3' });
  const result = makeResult({ newProposedRules: [rule1, rule2, rule3] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const actionsBlocks = blocks.filter(b => b.type === 'actions');
  const ruleActionBlocks = actionsBlocks.filter(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(
      e => 'action_id' in e && (e.action_id === 'approve_rule' || e.action_id === 'reject_rule'),
    );
  });
  expect(ruleActionBlocks.length).toBe(3);
});

test('Scenario 1: each approve button value contains correct ruleId', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const rule2 = makeRule({ id: 'rule-2' });
  const rule3 = makeRule({ id: 'rule-3' });
  const result = makeResult({ newProposedRules: [rule1, rule2, rule3] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const ruleIds: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'actions') continue;
    for (const el of block.elements ?? []) {
      if (!('action_id' in el) || el.action_id !== 'approve_rule') continue;
      if ('value' in el && typeof el.value === 'string') {
        const parsed = JSON.parse(el.value) as { ruleId?: string };
        if (parsed.ruleId) ruleIds.push(parsed.ruleId);
      }
    }
  }
  expect(ruleIds).toContain('rule-1');
  expect(ruleIds).toContain('rule-2');
  expect(ruleIds).toContain('rule-3');
});

test('Scenario 1: footer has add_custom_rule button', () => {
  const result = makeResult({ newProposedRules: [makeRule({ id: 'rule-1' })] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const hasAddRule = blocks.some(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(e => 'action_id' in e && e.action_id === 'add_custom_rule');
  });
  expect(hasAddRule).toBe(true);
});

test('Scenario 1: footer does NOT have remove_rule when confirmedRules is empty', () => {
  const result = makeResult({ newProposedRules: [makeRule({ id: 'rule-1' })] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const hasRemoveRule = blocks.some(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(e => 'action_id' in e && e.action_id === 'remove_rule');
  });
  expect(hasRemoveRule).toBe(false);
});

test('Scenario 2: empty recap — no new patterns message when result has no rules', () => {
  const confirmedRule = makeRule({ id: 'c-1', status: 'confirmed' });
  const result = makeResult({ newProposedRules: [] });
  const blocks = buildWeeklyRecapBlocks(result, [confirmedRule]);

  const sectionText = blocks
    .filter(b => b.type === 'section')
    .map(b => (b.type === 'section' ? b.text?.text ?? '' : ''))
    .join(' ');
  expect(sectionText).toContain('No new patterns detected');
});

test('Scenario 2: empty recap footer has both add_custom_rule and remove_rule when confirmed rules exist', () => {
  const confirmedRule = makeRule({ id: 'c-1', status: 'confirmed' });
  const result = makeResult({ newProposedRules: [] });
  const blocks = buildWeeklyRecapBlocks(result, [confirmedRule]);

  const hasAddRule = blocks.some(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(e => 'action_id' in e && e.action_id === 'add_custom_rule');
  });
  const hasRemoveRule = blocks.some(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(e => 'action_id' in e && e.action_id === 'remove_rule');
  });
  expect(hasAddRule).toBe(true);
  expect(hasRemoveRule).toBe(true);
});

test('Scenario 2: empty recap does NOT have approve_rule or reject_rule buttons', () => {
  const result = makeResult({ newProposedRules: [] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const hasRuleButtons = blocks.some(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(
      e => 'action_id' in e && (e.action_id === 'approve_rule' || e.action_id === 'reject_rule'),
    );
  });
  expect(hasRuleButtons).toBe(false);
});

test('Scenario 3: buildRuleActionedRecapBlocks approved — rule-1 buttons replaced with confirmed section', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const rule2 = makeRule({ id: 'rule-2' });
  const result = makeResult({ newProposedRules: [rule1, rule2] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const updated = buildRuleActionedRecapBlocks(blocks, 'rule-1', 'approved', 'U12345');

  const confirmedSection = updated.find(
    b => b.type === 'section' && 'text' in b && b.text?.text?.includes('✅ Confirmed by <@U12345>'),
  );
  expect(confirmedSection).toBeDefined();
});

test('Scenario 3: buildRuleActionedRecapBlocks — rule-2 buttons still present after rule-1 is actioned', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const rule2 = makeRule({ id: 'rule-2' });
  const result = makeResult({ newProposedRules: [rule1, rule2] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const updated = buildRuleActionedRecapBlocks(blocks, 'rule-1', 'approved', 'U12345');

  const rule2ActionsBlock = updated.find(b => {
    if (b.type !== 'actions') return false;
    return (b.elements ?? []).some(e => {
      if (!('value' in e) || typeof e.value !== 'string') return false;
      try {
        const parsed = JSON.parse(e.value) as { ruleId?: string };
        return parsed.ruleId === 'rule-2';
      } catch {
        return false;
      }
    });
  });
  expect(rule2ActionsBlock).toBeDefined();
});

test('Scenario 3: buildRuleActionedRecapBlocks rejected — rule-1 buttons replaced with rejected section', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const result = makeResult({ newProposedRules: [rule1] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const updated = buildRuleActionedRecapBlocks(blocks, 'rule-1', 'rejected', 'U99999');

  const rejectedSection = updated.find(
    b => b.type === 'section' && 'text' in b && b.text?.text?.includes('❌ Rejected by <@U99999>'),
  );
  expect(rejectedSection).toBeDefined();
});

test('buildRuleActionedRecapBlocks does not mutate original array', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const result = makeResult({ newProposedRules: [rule1] });
  const blocks = buildWeeklyRecapBlocks(result, []);
  const originalLength = blocks.length;
  const originalRef = blocks;

  const updated = buildRuleActionedRecapBlocks(blocks, 'rule-1', 'approved', 'U12345');

  expect(updated).not.toBe(originalRef);
  expect(blocks.length).toBe(originalLength);
});

test('Scenario 4: buildAddRuleModal callback_id is add_rule_modal', () => {
  const modal = buildAddRuleModal() as ModalView;
  expect(modal.callback_id).toBe('add_rule_modal');
});

test('Scenario 4: buildAddRuleModal has 2 input blocks with correct block_ids', () => {
  const modal = buildAddRuleModal() as ModalView;
  expect(Array.isArray(modal.blocks)).toBe(true);
  expect(modal.blocks?.length).toBe(2);
  const blockIds = modal.blocks?.map(b => b.block_id) ?? [];
  expect(blockIds).toContain('pattern_block');
  expect(blockIds).toContain('correction_block');
});

test('Scenario 4: buildAddRuleModal submit and close text', () => {
  const modal = buildAddRuleModal() as ModalView;
  expect(modal.submit?.text).toBe('Add Rule');
  expect(modal.close?.text).toBe('Cancel');
  expect(modal.title?.text).toBe('Add Custom Rule');
});

test('Scenario 5: buildRemoveRuleModal with 2 confirmed rules — callback_id is remove_rule_modal', () => {
  const r1 = makeRule({ id: 'r-1', status: 'confirmed', correction: 'Fix one' });
  const r2 = makeRule({ id: 'r-2', status: 'confirmed', correction: 'Fix two' });
  const modal = buildRemoveRuleModal([r1, r2]) as ModalView;
  expect(modal.callback_id).toBe('remove_rule_modal');
});

test('Scenario 5: buildRemoveRuleModal with 2 confirmed rules — checkboxes has 2 options with correct values', () => {
  const r1 = makeRule({ id: 'r-1', status: 'confirmed', correction: 'Fix one' });
  const r2 = makeRule({ id: 'r-2', status: 'confirmed', correction: 'Fix two' });
  const modal = buildRemoveRuleModal([r1, r2]) as ModalView;

  const inputBlock = modal.blocks?.find(b => b.type === 'input' && b.block_id === 'remove_rules_block');
  expect(inputBlock).toBeDefined();
  expect(inputBlock?.element?.type).toBe('checkboxes');
  expect(inputBlock?.element?.action_id).toBe('rules_to_remove');

  const optionValues = inputBlock?.element?.options?.map(o => o.value) ?? [];
  expect(optionValues).toContain('r-1');
  expect(optionValues).toContain('r-2');
});

test('buildRemoveRuleModal with no rules — shows "No active rules" section', () => {
  const modal = buildRemoveRuleModal([]) as ModalView;
  expect(modal.callback_id).toBe('remove_rule_modal');
  const section = modal.blocks?.find(b => b.type === 'section');
  expect(section?.text?.text).toContain('No active rules to remove');
});

test('buildWeeklyRecapBlocks with existingProposedRules combines them with result rules', () => {
  const ruleFromResult = makeRule({ id: 'new-1', pattern: 'pattern A' });
  const existingRule = makeRule({ id: 'existing-1', pattern: 'pattern B' });
  const result = makeResult({ newProposedRules: [ruleFromResult] });
  const blocks = buildWeeklyRecapBlocks(result, [], [existingRule]);

  const ruleIds: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'actions') continue;
    for (const el of block.elements ?? []) {
      if (!('action_id' in el) || el.action_id !== 'approve_rule') continue;
      if ('value' in el && typeof el.value === 'string') {
        const parsed = JSON.parse(el.value) as { ruleId?: string };
        if (parsed.ruleId) ruleIds.push(parsed.ruleId);
      }
    }
  }
  expect(ruleIds).toContain('new-1');
  expect(ruleIds).toContain('existing-1');
});

test('buildWeeklyRecapBlocks caps at 10 rules when more than 10 passed', () => {
  const rules: LearnedRule[] = Array.from({ length: 12 }, (_, i) =>
    makeRule({ id: `rule-${i}` }),
  );
  const result = makeResult({ newProposedRules: rules });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const approveButtons: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'actions') continue;
    for (const el of block.elements ?? []) {
      if (!('action_id' in el) || el.action_id !== 'approve_rule') continue;
      approveButtons.push('found');
    }
  }
  expect(approveButtons.length).toBe(10);
});

test('buildWeeklyRecapBlocks with proposed rules has context block with active rules count', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const confirmed = makeRule({ id: 'c-1', status: 'confirmed' });
  const result = makeResult({ newProposedRules: [rule1] });
  const blocks = buildWeeklyRecapBlocks(result, [confirmed]);

  const allContextText = blocks
    .filter(b => b.type === 'context')
    .flatMap(b => (b.type === 'context' ? (b.elements ?? []) : []))
    .map(e => ('text' in e ? e.text : ''))
    .join(' ');
  expect(allContextText).toContain('1 active rule(s) currently in effect');
});

test('buildWeeklyRecapBlocks dividers between rules but not after last', () => {
  const rules = [makeRule({ id: 'r-1' }), makeRule({ id: 'r-2' }), makeRule({ id: 'r-3' })];
  const result = makeResult({ newProposedRules: rules });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const dividers = blocks.filter(b => b.type === 'divider');
  expect(dividers.length).toBe(2);
});

test('buildWeeklyRecapBlocks section text truncates to 500 chars', () => {
  const longPattern = 'A'.repeat(400);
  const longCorrection = 'B'.repeat(400);
  const rule = makeRule({ pattern: longPattern, correction: longCorrection });
  const result = makeResult({ newProposedRules: [rule] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const ruleSection = blocks.find(b => {
    if (b.type !== 'section') return false;
    return b.text?.text?.startsWith('*Pattern:*');
  });
  expect(ruleSection).toBeDefined();
  if (ruleSection?.type === 'section') {
    expect((ruleSection.text?.text ?? '').length).toBeLessThanOrEqual(501);
    expect(ruleSection.text?.text).toEndWith('…');
  }
});

test('buildRuleActionedRecapBlocks with unknown ruleId returns identical array', () => {
  const rule1 = makeRule({ id: 'rule-1' });
  const result = makeResult({ newProposedRules: [rule1] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const updated = buildRuleActionedRecapBlocks(blocks, 'nonexistent-id', 'approved', 'U000');
  expect(JSON.stringify(updated)).toBe(JSON.stringify(blocks));
});

test('buildAddRuleModal pattern_block element is plain_text_input', () => {
  type InputBlock = { type: string; block_id?: string; element?: { type?: string; action_id?: string; multiline?: boolean } };
  const modal = buildAddRuleModal() as { blocks?: InputBlock[] };
  const patternBlock = modal.blocks?.find(b => b.block_id === 'pattern_block');
  expect(patternBlock?.element?.type).toBe('plain_text_input');
  expect(patternBlock?.element?.action_id).toBe('pattern_input');
  expect(patternBlock?.element?.multiline).toBe(false);
});

test('buildAddRuleModal correction_block element is multiline plain_text_input', () => {
  type InputBlock = { type: string; block_id?: string; element?: { type?: string; action_id?: string; multiline?: boolean } };
  const modal = buildAddRuleModal() as { blocks?: InputBlock[] };
  const correctionBlock = modal.blocks?.find(b => b.block_id === 'correction_block');
  expect(correctionBlock?.element?.type).toBe('plain_text_input');
  expect(correctionBlock?.element?.action_id).toBe('correction_input');
  expect(correctionBlock?.element?.multiline).toBe(true);
});

test('buildRemoveRuleModal correction text truncated to 75 chars in option labels', () => {
  const longCorrection = 'X'.repeat(100);
  const rule = makeRule({ id: 'r-long', correction: longCorrection, status: 'confirmed' });
  const modal = buildRemoveRuleModal([rule]) as ModalView;
  const inputBlock = modal.blocks?.find(b => b.block_id === 'remove_rules_block');
  const optionText = inputBlock?.element?.options?.[0]?.text?.text ?? '';
  expect(optionText.length).toBeLessThanOrEqual(75);
});

test('buildWeeklyRecapBlocks context shows example original text when available', () => {
  const rule = makeRule({
    id: 'rule-ex',
    examples: [{ original: 'Hi! Welcome to our property.', edited: 'Welcome to our property.' }],
  });
  const result = makeResult({ newProposedRules: [rule] });
  const blocks = buildWeeklyRecapBlocks(result, []);

  const allContextText = blocks
    .filter(b => b.type === 'context')
    .flatMap(b => (b.type === 'context' ? (b.elements ?? []) : []))
    .map(e => ('text' in e ? e.text : ''))
    .join(' ');
  expect(allContextText).toContain('AI wrote:');
  expect(allContextText).toContain('Hi! Welcome to our property.');
});

test('buildWeeklyRecapBlocks returns KnownBlock array', () => {
  const result = makeResult();
  const blocks = buildWeeklyRecapBlocks(result, []);
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(typeof block.type).toBe('string');
  }
});
