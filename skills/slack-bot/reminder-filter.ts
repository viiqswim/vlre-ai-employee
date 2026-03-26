/**
 * Pure reminder filter logic — no I/O, no Slack calls.
 * Determines which pending threads need a reminder based on age and recency.
 */

export interface PendingThreadEntry {
  threadUid: string;
  slackTs: string;
  channelId: string;
  messageUid: string;
  guestName?: string;
  propertyName?: string;
  lastReminderSentAt?: number;
}

export const REMINDER_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
export const REMINDER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between repeats

/**
 * Get threads that need a reminder.
 *
 * A thread needs a reminder if BOTH conditions are true:
 * 1. It has been pending for 30+ minutes (REMINDER_THRESHOLD_MS)
 * 2. It has never been reminded OR 30+ minutes have passed since the last reminder
 *
 * @param threads Record of threadUid -> PendingThreadEntry
 * @param now Current timestamp in milliseconds (defaults to Date.now() for testing)
 * @returns Array of PendingThreadEntry objects sorted by postedAtMs ascending (oldest first)
 */
export function getThreadsNeedingReminder(
  threads: Record<string, PendingThreadEntry>,
  now: number = Date.now()
): PendingThreadEntry[] {
  const needsReminder: PendingThreadEntry[] = [];

  for (const [threadUid, entry] of Object.entries(threads)) {
    const postedAtMs = Math.floor(parseFloat(entry.slackTs) * 1000);
    const elapsedMs = now - postedAtMs;

    // Check condition 1: pending 30+ minutes
    if (elapsedMs < REMINDER_THRESHOLD_MS) {
      continue;
    }

    // Check condition 2: never reminded OR 30+ minutes since last reminder
    const hasNeverBeenReminded = entry.lastReminderSentAt === undefined;
    const lastReminderElapsedMs = now - (entry.lastReminderSentAt ?? 0);
    const isTimeForRepeat = lastReminderElapsedMs >= REMINDER_INTERVAL_MS;

    if (!hasNeverBeenReminded && !isTimeForRepeat) {
      continue;
    }

    // Include this thread
    needsReminder.push({
      ...entry,
      threadUid,
    });
  }

  // Sort by postedAtMs ascending (oldest first — most urgent first)
  needsReminder.sort((a, b) => {
    const aPostedAtMs = Math.floor(parseFloat(a.slackTs) * 1000);
    const bPostedAtMs = Math.floor(parseFloat(b.slackTs) * 1000);
    return aPostedAtMs - bPostedAtMs;
  });

  return needsReminder;
}
