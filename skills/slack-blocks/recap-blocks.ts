import type { KnownBlock } from '@slack/types';
import type { WeeklyAnalysisResult } from '../pipeline/edit-analyzer.js';
import type { LearnedRule } from '../pipeline/learned-rules.js';

function formatRecapDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function buildWeeklyRecapBlocks(
  result: WeeklyAnalysisResult,
  confirmedRules: LearnedRule[],
  existingProposedRules?: LearnedRule[],
): KnownBlock[] {
  const header = `📊 Weekly Rules Recap — ${formatRecapDate(new Date())}`;

  const allProposed: LearnedRule[] = [
    ...(result.newProposedRules ?? []),
    ...(existingProposedRules ?? []),
  ];

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: header, emoji: true },
    },
  ];

  if (allProposed.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ No new patterns detected this week. ${confirmedRules.length} active rule(s) in effect.`,
      },
    });

    const footerElements = [
      {
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: '📝 Add Custom Rule', emoji: true },
        action_id: 'add_custom_rule',
        value: 'add_rule',
      },
      ...(confirmedRules.length > 0
        ? [
            {
              type: 'button' as const,
              text: { type: 'plain_text' as const, text: '🗑️ Remove Rule', emoji: true },
              action_id: 'remove_rule',
              value: 'remove_rule',
            },
          ]
        : []),
    ];

    blocks.push({ type: 'actions', elements: footerElements });

    return blocks;
  }

  let rulesToShow = allProposed;
  if (allProposed.length > 10) {
    console.warn('[RULES] Too many proposed rules for recap, capping at 10');
    rulesToShow = allProposed.slice(0, 10);
  }

  for (let i = 0; i < rulesToShow.length; i++) {
    const rule = rulesToShow[i]!;
    const example = rule.examples[0];

    const fullText = `*Pattern:* ${rule.pattern}\n*Fix:* ${rule.correction}`;
    const sectionText = fullText.length > 500 ? `${fullText.substring(0, 499)}…` : fullText;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: sectionText },
    });

    const examplePart = example
      ? ` — e.g., AI wrote: "${example.original.substring(0, 60)}"`
      : '';

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Observed in *${rule.frequency}* edit(s)${examplePart}`,
        },
      ],
    });

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: 'approve_rule',
          value: JSON.stringify({ ruleId: rule.id }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject', emoji: true },
          style: 'danger',
          action_id: 'reject_rule',
          value: JSON.stringify({ ruleId: rule.id }),
        },
      ],
    });

    if (i < rulesToShow.length - 1) {
      blocks.push({ type: 'divider' });
    }
  }

  const footerElements = [
    {
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: '📝 Add Custom Rule', emoji: true },
      action_id: 'add_custom_rule',
      value: 'add_rule',
    },
    ...(confirmedRules.length > 0
      ? [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: '🗑️ Remove Rule', emoji: true },
            action_id: 'remove_rule',
            value: 'remove_rule',
          },
        ]
      : []),
  ];

  blocks.push({ type: 'actions', elements: footerElements });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${confirmedRules.length} active rule(s) currently in effect`,
      },
    ],
  });

  return blocks;
}

export function buildRuleActionedRecapBlocks(
  originalBlocks: KnownBlock[],
  ruleId: string,
  action: 'approved' | 'rejected',
  userId: string,
): KnownBlock[] {
  const statusText =
    action === 'approved'
      ? `✅ Confirmed by <@${userId}>`
      : `❌ Rejected by <@${userId}>`;

  return originalBlocks.map((block): KnownBlock => {
    if (block.type !== 'actions') return block;

    const hasMatchingRule = (block.elements ?? []).some(element => {
      if (element.type !== 'button') return false;
      const val = element.value;
      if (!val) return false;
      try {
        const parsed = JSON.parse(val) as { ruleId?: string };
        return parsed.ruleId === ruleId;
      } catch {
        return false;
      }
    });

    if (!hasMatchingRule) return block;

    return {
      type: 'section',
      text: { type: 'mrkdwn', text: statusText },
    };
  });
}

export function buildAddRuleModal(): object {
  return {
    type: 'modal',
    callback_id: 'add_rule_modal',
    title: { type: 'plain_text', text: 'Add Custom Rule' },
    submit: { type: 'plain_text', text: 'Add Rule' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'pattern_block',
        label: { type: 'plain_text', text: 'What does the AI do wrong?', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'pattern_input',
          multiline: false,
          placeholder: { type: 'plain_text', text: 'e.g., AI adds greeting before answering' },
        },
      },
      {
        type: 'input',
        block_id: 'correction_block',
        label: { type: 'plain_text', text: 'How should it respond instead?', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'correction_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'e.g., Answer directly without Hi/Hey' },
        },
      },
    ],
  };
}

export function buildRemoveRuleModal(confirmedRules: LearnedRule[]): object {
  if (confirmedRules.length === 0) {
    return {
      type: 'modal',
      callback_id: 'remove_rule_modal',
      title: { type: 'plain_text', text: 'Remove Rule' },
      submit: { type: 'plain_text', text: 'Remove Selected' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'No active rules to remove.' },
        },
      ],
    };
  }

  return {
    type: 'modal',
    callback_id: 'remove_rule_modal',
    title: { type: 'plain_text', text: 'Remove Rule' },
    submit: { type: 'plain_text', text: 'Remove Selected' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'remove_rules_block',
        label: { type: 'plain_text', text: 'Select rules to deactivate:' },
        element: {
          type: 'checkboxes',
          action_id: 'rules_to_remove',
          options: confirmedRules.map(rule => ({
            text: { type: 'mrkdwn', text: rule.correction.substring(0, 75) },
            value: rule.id,
          })),
        },
      },
    ],
  };
}
