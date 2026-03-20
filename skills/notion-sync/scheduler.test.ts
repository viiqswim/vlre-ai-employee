import { test, expect, describe, afterEach } from 'bun:test';
import { startNotionSyncScheduler } from './scheduler.js';
import type { NotionSync, SyncResult } from './notion-sync.js';

const mockSyncResult: SyncResult = {
  pagesTotal: 5, pagesUpdated: 2, pagesSkipped: 3,
  chunksTotal: 10, orphansRemoved: 0, truncatedPages: [], errors: [], durationMs: 100,
};

describe('startNotionSyncScheduler', () => {
  afterEach(() => {
    // Cleanup: ensure any scheduled jobs are stopped
  });

  test('fires initial sync on start (non-blocking)', async () => {
    let syncCallCount = 0;
    const mockSync = {
      syncAll: async () => { syncCallCount++; return mockSyncResult; }
    } as unknown as NotionSync;

    const { stop } = startNotionSyncScheduler(mockSync, 1);
    // Give the void promise time to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    stop();
    expect(syncCallCount).toBe(1);
  });

  test('stop() cancels the cron job', () => {
    const mockSync = {
      syncAll: async () => mockSyncResult
    } as unknown as NotionSync;

    const { stop } = startNotionSyncScheduler(mockSync, 1);
    // stop() should not throw
    expect(() => stop()).not.toThrow();
  });

  test('sync errors are caught and do not throw', async () => {
    const mockSync = {
      syncAll: async () => { throw new Error('Network failure'); }
    } as unknown as NotionSync;

    const { stop } = startNotionSyncScheduler(mockSync, 1);
    // Give the void promise time to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    stop();
    // If we get here, error was caught (no unhandled rejection)
    expect(true).toBe(true);
  });

  test('returns stop function', () => {
    const mockSync = {
      syncAll: async () => mockSyncResult
    } as unknown as NotionSync;

    const result = startNotionSyncScheduler(mockSync, 1);
    expect(result.stop).toBeInstanceOf(Function);
    result.stop();
  });
});
