import type { KnownBlock } from '@slack/types';
import type { LearnedRule } from '../pipeline/learned-rules.js';

/**
 * Builds a Slack Block Kit message for a newly auto-confirmed learned rule.
 * The message informs the CS team and offers a one-click reject option.
 */
export function buildRuleNotificationBlocks(rule: LearnedRule): KnownBlock[] {
  const scope = rule.scope ?? 'global';
  const scopeLabel = scope === 'global' ? 'All properties' : scope;
  
  const example = rule.examples[0];
  const exampleText = example
    ? `\n\n_Example:_\n• AI wrote: "${example.original.substring(0, 80).trim()}${example.original.length > 80 ? '…' : ''}"\n• CS changed to: "${example.edited.substring(0, 80).trim()}${example.edited.length > 80 ? '…' : ''}"`
    : '';

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🧠 *New rule learned from CS team edit*\n*Rule:* ${rule.correction}\n*Scope:* ${scopeLabel}${exampleText}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject This Rule', emoji: true },
          style: 'danger',
          action_id: 'reject_rule',
          value: JSON.stringify({ ruleId: rule.id }),
        },
      ],
    },
  ];

  return blocks;
}
