import { Cron } from 'croner';
import type { NotionSync, SyncResult } from './notion-sync.js';

/**
 * Starts the Notion sync scheduler.
 * Runs an initial sync immediately (non-blocking), then every `intervalHours` hours.
 * All errors are caught and logged — never propagates exceptions.
 *
 * @returns { stop } function to cancel the scheduler (for graceful shutdown)
 */
export function startNotionSyncScheduler(
  sync: NotionSync,
  intervalHours: number
): { stop: () => void } {
  const runSync = async (): Promise<void> => {
    try {
      const result: SyncResult = await sync.syncAll();
      console.log(
        `[NOTION-SYNC] Sync complete: ${result.pagesUpdated} updated, ` +
        `${result.pagesSkipped} skipped, ${result.chunksTotal} chunks, ` +
        `${result.orphansRemoved} orphans removed` +
        (result.errors.length > 0 ? `, ${result.errors.length} errors` : '') +
        (result.truncatedPages.length > 0 ? `, ${result.truncatedPages.length} truncated` : '') +
        ` (${result.durationMs}ms)`
      );
    } catch (error) {
      console.error(`[NOTION-SYNC] Sync failed: ${(error as Error).message}`);
    }
  };

  // Fire initial sync immediately (non-blocking — don't await at module level)
  void runSync();

  // Schedule recurring sync: `0 */N * * *` runs every N hours at minute 0
  const cronExpr = `0 */${intervalHours} * * *`;
  const job = new Cron(cronExpr, () => { void runSync(); });

  return {
    stop: () => { job.stop(); },
  };
}
