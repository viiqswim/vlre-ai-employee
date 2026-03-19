import type { App } from '@slack/bolt';
import { Cron } from 'croner';
import { runWeeklyAnalysis } from '../pipeline/edit-analyzer.js';
import { getConfirmedRules, loadRules, getLastAnalyzed } from '../pipeline/rules-store.js';
import { buildWeeklyRecapBlocks } from '../slack-blocks/recap-blocks.js';

let cronJob: Cron | null = null;
let isRunning = false;
let _app: App | null = null;
let _slackChannelId = '';

async function runAnalysis(): Promise<void> {
  if (isRunning) {
    console.log('[SCHEDULER] Analysis already in progress, skipping');
    return;
  }

  isRunning = true;

  try {
    const result = await runWeeklyAnalysis();
    const confirmedRules = getConfirmedRules();
    const allRules = loadRules();
    const existingProposed = allRules.filter(
      r => r.status === 'proposed' && !result.newProposedRules.some(n => n.id === r.id),
    );
    const blocks = buildWeeklyRecapBlocks(result, confirmedRules, existingProposed);
    await _app!.client.chat.postMessage({ channel: _slackChannelId, blocks, text: '📊 Weekly Rules Recap' });
    console.log(
      `[SCHEDULER] Weekly recap posted: ${result.newProposedRules.length} new rules, ${confirmedRules.length} active`,
    );
  } catch (error) {
    await _app!.client.chat.postMessage({
      channel: _slackChannelId,
      text: `⚠️ Weekly rules analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    isRunning = false;
  }
}

export function startScheduler(app: App, slackChannelId: string): void {
  _app = app;
  _slackChannelId = slackChannelId;
  cronJob = new Cron('0 12 * * 5', { timezone: 'America/Chicago' }, runAnalysis);
  console.log('[SCHEDULER] Weekly analysis scheduled: Friday 12:00 PM CST');
}

export function stopScheduler(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  console.log('[SCHEDULER] Scheduler stopped');
}

export async function checkMissedRun(app: App, slackChannelId: string): Promise<void> {
  _app = app;
  _slackChannelId = slackChannelId;
  const lastAnalyzed = getLastAnalyzed();
  if (lastAnalyzed === null || (Date.now() - new Date(lastAnalyzed).getTime()) > 7 * 24 * 60 * 60 * 1000) {
    console.log(`[SCHEDULER] Missed run detected (last: ${lastAnalyzed ?? 'never'}). Running now...`);
    await runAnalysis();
  }
}
