/**
 * Papi Chulo — Slack Block Kit Message Builders
 *
 * Builds Block Kit JSON for the CS team approval workflow.
 * All functions return KnownBlock[] arrays for use with chat.postMessage.
 */

import type { KnownBlock } from '@slack/types';

export interface ApprovalMessageParams {
  guestName: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  nightCount: number;
  channel: string; // e.g., "AIRBNB", "VRBO", "BOOKING_COM", "DIRECT"
  guestMessage: string;
  draftResponse: string;
  confidence: number; // 0.0 - 1.0
  classification: string;
  summary: string;
  conversationSummary: string | null;
  messageUid: string;
  threadUid: string;
  leadUid: string;
}

/** Format confidence as a display string with emoji indicator */
export function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.8) return `${pct}% ✅`;
  if (confidence >= 0.5) return `${pct}% ⚠️`;
  return `${pct}% 🔴 Low — review carefully`;
}

/** Format channel name for display */
export function formatChannel(channel: string): string {
  const map: Record<string, string> = {
    AIRBNB: '🏠 Airbnb',
    VRBO: '🏡 VRBO',
    BOOKING_COM: '🌐 Booking.com',
    DIRECT: '📧 Direct',
  };
  return map[channel.toUpperCase()] ?? channel;
}

/**
 * Build the main approval message with guest info, draft response, and action buttons.
 * This is what the CS team sees when a new guest message arrives.
 */
export function buildApprovalBlocks(params: ApprovalMessageParams): KnownBlock[] {
  // Embed metadata in button values (max 2000 chars per Slack limit)
  const metadata = JSON.stringify({
    messageUid: params.messageUid,
    threadUid: params.threadUid,
    leadUid: params.leadUid,
    draftResponse: params.draftResponse.substring(0, 1500),
  });

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🏠 New Guest Message — ${params.propertyName}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Guest:* ${params.guestName}  |  *Dates:* ${params.checkInDate} – ${params.checkOutDate} (${params.nightCount}n)  |  *Channel:* ${formatChannel(params.channel)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Confidence:* ${formatConfidence(params.confidence)}  |  *Category:* ${params.classification}`,
        },
      ],
    },
    { type: 'divider' },
    ...(params.conversationSummary ? [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📋 Conversation so far:*\n${params.conversationSummary}`,
        },
      } as KnownBlock,
    ] : []),
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*💬 Latest message:*\n>${params.guestMessage.replace(/\n/g, '\n>')}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🤖 Suggested response:*\n>${params.draftResponse.replace(/\n/g, '\n>')}`,
      },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: 'approve_response',
          value: metadata,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject', emoji: true },
          style: 'danger',
          action_id: 'reject_response',
          value: metadata,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit & Send', emoji: true },
          action_id: 'edit_response',
          value: metadata,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 View in Hostfully', emoji: true },
          action_id: 'view_in_hostfully',
          url: `https://platform.hostfully.com/app/#/inbox?threadUid=${params.threadUid}&leadUid=${params.leadUid}`,
        },
      ],
    },
  ];
}

/**
 * Build the "approved" state — replaces the approval message after CS team approves.
 */
export function buildApprovedBlocks(approverUserId: string, sentResponse: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Approved and sent* by <@${approverUserId}> — <!date^${Math.floor(Date.now() / 1000)}^{time}|just now>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Sent:* ${sentResponse.substring(0, 200)}${sentResponse.length > 200 ? '…' : ''}`,
        },
      ],
    },
  ];
}

/**
 * Build the "rejected" state — replaces the approval message after CS team rejects.
 */
export function buildRejectedBlocks(rejectorUserId: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *Rejected* by <@${rejectorUserId}> — <!date^${Math.floor(Date.now() / 1000)}^{time}|just now>\n_Response will not be sent to the guest._`,
      },
    },
  ];
}

export function buildSupersededBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⏭️ *Superseded* — a newer message from this guest is pending review below.\n_This suggested response was not sent._`,
      },
    },
  ];
}

/**
 * Build the "edited and sent" state — replaces the approval message after CS team edits.
 */
export function buildEditedBlocks(editorUserId: string, editedResponse: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✏️ *Edited and sent* by <@${editorUserId}> — <!date^${Math.floor(Date.now() / 1000)}^{time}|just now>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Sent:* ${editedResponse.substring(0, 200)}${editedResponse.length > 200 ? '…' : ''}`,
        },
      ],
    },
  ];
}

/**
 * Build an error state — shown when Hostfully send fails after approval.
 */
export function buildErrorBlocks(errorMessage: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚨 *Send failed* — ${errorMessage}\n_The response was NOT sent to the guest. Please send manually._`,
      },
    },
  ];
}

/**
 * Build the edit modal view for the "Edit & Send" flow.
 * Returns a Slack view payload (not KnownBlock[]).
 */
export function buildEditModal(params: {
  draftResponse: string;
  channelId: string;
  messageTs: string;
  threadUid: string;
  leadUid: string;
  messageUid: string;
}): object {
  const privateMetadata = JSON.stringify({
    channelId: params.channelId,
    messageTs: params.messageTs,
    threadUid: params.threadUid,
    leadUid: params.leadUid,
    messageUid: params.messageUid,
  });

  return {
    type: 'modal',
    callback_id: 'edit_response_modal',
    private_metadata: privateMetadata.substring(0, 3000), // Slack private_metadata max 3000 chars
    title: { type: 'plain_text', text: 'Edit Response', emoji: true },
    submit: { type: 'plain_text', text: 'Send Edited Response', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'input',
        block_id: 'edited_response_block',
        label: { type: 'plain_text', text: 'Edit the response before sending:', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'edited_response_input',
          multiline: true,
          initial_value: params.draftResponse,
          placeholder: { type: 'plain_text', text: 'Type your response here...' },
        },
      },
    ],
  };
}
