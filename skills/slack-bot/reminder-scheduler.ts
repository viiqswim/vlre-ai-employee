import { Cron } from 'croner';
import type { App } from '@slack/bolt';
import { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import { getThreadsNeedingReminder, type PendingThreadEntry } from './reminder-filter.ts';
import { buildReminderBlocks, type ReminderThread } from '../slack-blocks/reminder-blocks.ts';
import { appendAuditLog } from '../audit-logger/audit-logger.ts';

let _app: App | null = null;
let _slackChannelId: string = '';
let _threadTracker: SlackThreadTracker | null = null;
let _cronJob: Cron | null = null;
let _isRunning = false;

export function startReminderScheduler(
  app: App,
  slackChannelId: string,
  threadTracker: SlackThreadTracker,
): void {
  if (slackChannelId === '') {
    console.warn('[REMINDER] No Slack channel configured — reminder scheduler not started');
    return;
  }
  _app = app;
  _slackChannelId = slackChannelId;
  _threadTracker = threadTracker;
  _cronJob = new Cron('*/5 * * * *', { timezone: 'America/Chicago' }, checkUnrespondedMessages);
  console.log('[REMINDER] Reminder scheduler started: every 5 minutes');
}

export function stopReminderScheduler(): void {
  _cronJob?.stop();
  console.log('[REMINDER] Reminder scheduler stopped');
}

export async function checkUnrespondedMessages(): Promise<void> {
  if (!_app || !_threadTracker || !_slackChannelId) {
    console.warn('[REMINDER] Scheduler not initialized — skipping');
    return;
  }

  if (_isRunning) {
    console.log('[REMINDER] Previous check still running, skipping');
    return;
  }

  _isRunning = true;

  try {
    const allPending = _threadTracker.getAllPending();

    const entriesWithUids: Record<string, PendingThreadEntry> = {};
    for (const [uid, thread] of Object.entries(allPending)) {
      entriesWithUids[uid] = { ...thread, threadUid: uid };
    }

    const qualifying = getThreadsNeedingReminder(entriesWithUids, Date.now());

    if (qualifying.length === 0) {
      console.log('[REMINDER] No unresponded messages qualify for reminder');
      return;
    }

    // TOCTOU guard: re-verify each thread still exists in the tracker
    // (it may have been cleared between getAllPending and here)
    const activeThreads = qualifying.filter(thread => {
      const current = _threadTracker!.getPending(thread.threadUid);
      return current !== undefined;
    });

    if (activeThreads.length === 0) {
      return;
    }

    const reminderThreads: ReminderThread[] = [];
    for (const thread of activeThreads) {
      try {
        const result = await _app!.client.chat.getPermalink({
          channel: thread.channelId,
          message_ts: thread.slackTs,
        });
        reminderThreads.push({
          threadUid: thread.threadUid,
          guestName: thread.guestName ?? 'Unknown guest',
          propertyName: thread.propertyName ?? 'Unknown property',
          elapsedMinutes: Math.floor(
            (Date.now() - SlackThreadTracker.getPostedAtMs(thread.slackTs)) / 60000,
          ),
          permalink: result.permalink as string,
        });
      } catch (err) {
        console.warn(
          `[REMINDER] Failed to get permalink for ${thread.threadUid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (reminderThreads.length === 0) {
      console.warn('[REMINDER] All permalink fetches failed — skipping reminder');
      return;
    }

    const blocks = buildReminderBlocks(reminderThreads);
    await _app!.client.chat.postMessage({
      channel: _slackChannelId,
      blocks,
      text: `⏰ ${reminderThreads.length} unresponded message(s) awaiting action`,
    });

    for (const thread of reminderThreads) {
      _threadTracker!.updateReminderSentAt(thread.threadUid, Date.now());
    }

    // Fire-and-forget — do NOT await
    appendAuditLog({
      action: 'reminder_sent',
      pendingCount: reminderThreads.length,
      threadUids: reminderThreads.map(t => t.threadUid),
    });

    console.log(`[REMINDER] Sent reminder for ${reminderThreads.length} unresponded message(s)`);
  } finally {
    _isRunning = false;
  }
}
