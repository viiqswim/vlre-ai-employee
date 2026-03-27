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

  // Build compact mrkdwn bullet list — one line per thread
  // Each line: • *GuestName* · PropertyName · ElapsedTime · <permalink|View>
  const lines = threads.map(thread =>
    `• *${escapeMrkdwn(thread.guestName)}* · ${escapeMrkdwn(thread.propertyName)} · ${formatElapsedTime(thread.elapsedMinutes)} · <${thread.permalink}|View>`
  );

  // Chunk lines into section blocks (Slack mrkdwn text field max: 3000 chars)
  // This ensures we never exceed the character limit regardless of thread count
  const MRKDWN_CHAR_LIMIT = 3000;
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineWithNewline = line + '\n';
    if (currentChunk.length > 0 && currentLength + lineWithNewline.length > MRKDWN_CHAR_LIMIT) {
      // Flush current chunk as a section block
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: currentChunk.join('\n') },
      });
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(line);
    currentLength += lineWithNewline.length;
  }

  // Flush remaining lines
  if (currentChunk.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: currentChunk.join('\n') },
    });
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
