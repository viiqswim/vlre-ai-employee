import type { KnownBlock } from '@slack/types';
import type { LearnedRule } from '../pipeline/learned-rules.js';

export function buildLearningConfirmationBlocks(proposal: LearnedRule): KnownBlock[] {
  const scope = proposal.scope ?? 'global';
  const scopeLabel = scope === 'global' ? 'All properties' : scope;
  const type = proposal.type ?? 'rule';

  const headerText =
    type === 'knowledge'
      ? '📚 *I learned something new from your edit — please review*'
      : '🧠 *I noticed a pattern in your edit — please review*';

  // Build fields for the content section
  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*What I'll learn:*\n${proposal.correction}` },
    { type: 'mrkdwn', text: `*Scope:*\n${scopeLabel}` },
  ];

  if (type === 'knowledge') {
    const kbBasename = proposal.kbFilePath
      ? (proposal.kbFilePath.split('/').pop() ?? 'common.md')
      : 'common.md';
    fields.push({ type: 'mrkdwn', text: `*Will be added to:*\n\`${kbBasename}\`` });
  }

  const example = proposal.examples[0];

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: headerText },
    },
    {
      type: 'section',
      fields,
    },
  ];

  if (example) {
    const orig =
      example.original.substring(0, 80).trim() + (example.original.length > 80 ? '…' : '');
    const edited =
      example.edited.substring(0, 80).trim() + (example.edited.length > 80 ? '…' : '');
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_Example:_ AI wrote: "${orig}"  →  CS changed to: "${edited}"`,
        },
      ],
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Confirm', emoji: true },
        style: 'primary',
        action_id: 'confirm_learning',
        value: JSON.stringify({ proposalId: proposal.id }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Edit', emoji: true },
        action_id: 'edit_learning',
        value: JSON.stringify({ proposalId: proposal.id }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ Reject', emoji: true },
        style: 'danger',
        action_id: 'reject_learning',
        value: JSON.stringify({ proposalId: proposal.id }),
      },
    ],
  });

  return blocks;
}

/**
 * Builds the Slack modal for refining a learning proposal.
 * Opens when the CS team clicks "Edit" on a learning confirmation message.
 */
export function buildLearningEditModal(
  proposal: LearnedRule,
  channelId: string,
  messageTs: string,
): object {
  // private_metadata max is 3000 chars — only store the minimal set of IDs
  const privateMetadata = JSON.stringify({
    proposalId: proposal.id,
    channelId,
    messageTs,
  });

  return {
    type: 'modal',
    callback_id: 'edit_learning_modal',
    private_metadata: privateMetadata.substring(0, 3000),
    title: { type: 'plain_text', text: 'Refine Learning' },
    submit: { type: 'plain_text', text: 'Save & Re-Review' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'learning_text_block',
        label: { type: 'plain_text', text: 'What should Papi Chulo learn?' },
        element: {
          type: 'plain_text_input',
          action_id: 'learning_text_input',
          multiline: true,
          initial_value: proposal.correction,
        },
      },
    ],
  };
}

/**
 * Builds replacement blocks shown after the CS team acts on a learning proposal.
 * Replaces the 3-button actions block with a single status line.
 */
export function buildLearningActionedBlocks(
  action: 'confirmed' | 'rejected',
  userId: string,
): KnownBlock[] {
  const text =
    action === 'confirmed'
      ? `✅ *Confirmed by <@${userId}>* — Papi Chulo will apply this learning.`
      : `❌ *Rejected by <@${userId}>* — This learning was discarded.`;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];
}
