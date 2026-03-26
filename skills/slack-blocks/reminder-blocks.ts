import type { KnownBlock } from '@slack/types';
import { escapeMrkdwn } from './blocks.ts';

/**
 * Represents a single unresponded thread pending reminder.
 */
export interface ReminderThread {
  threadUid: string;
  guestName: string; // already resolved: "Unknown guest" if not available
  propertyName: string; // already resolved: "Unknown property" if not available
  elapsedMinutes: number; // minutes since posted to Slack
  permalink: string; // Slack permalink URL to original approval message
}

/**
 * Format elapsed time in minutes to a human-readable string.
 * - < 60 minutes: "N min"
 * - >= 60 minutes: "Nh Mmin"
 */
export function formatElapsedTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min`;
}

/**
 * Build a consolidated reminder message for unresponded threads.
 * Returns a Block Kit message showing all pending threads with a "View Message" link button.
 */
export function buildReminderBlocks(threads: ReminderThread[]): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header block
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `⏰ ${threads.length} Unresponded Message(s)`,
      emoji: true,
    },
  });

  // Timestamp context block
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Checked at ${timeStr} · ${dateStr}`,
      },
    ],
  });

  // Thread entries with dividers
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]!;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Guest:* ${escapeMrkdwn(thread.guestName)}\n*Property:* ${escapeMrkdwn(thread.propertyName)}\n*Pending:* ${formatElapsedTime(thread.elapsedMinutes)}`,
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Message',
          emoji: true,
        },
        url: thread.permalink,
      },
    });

    // Add divider between entries (not after the last one)
    if (i < threads.length - 1) {
      blocks.push({ type: 'divider' });
    }
  }

  // Footer context block
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'These messages have been awaiting response for 30+ minutes.',
      },
    ],
  });

  return blocks;
}
