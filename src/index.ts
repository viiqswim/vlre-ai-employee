import { createSlackApp, startSlackApp, stopSlackApp } from '../skills/slack-bot/app.ts';
import { registerAllHandlers } from '../skills/slack-bot/handlers.ts';
import { startScheduler, stopScheduler } from '../skills/slack-bot/scheduler.js';
import { startReminderScheduler, stopReminderScheduler } from '../skills/slack-bot/reminder-scheduler.ts';
import { registerKBAssistantHandlers } from '../skills/kb-assistant/index.js';
import { createHostfullyClient } from '../skills/hostfully-client/index.ts';
import { createSifelyClient } from '../skills/sifely-client/sifely-client.ts';
import { createVlreHubClient } from '../skills/vlre-hub-client/vlre-hub-client.ts';
import { createMultiPropertyKBReader } from '../skills/kb-reader/index.ts';
import { createThreadTracker } from '../skills/thread-tracker/index.ts';
import { startWebhookReceiver } from './webhook-receiver.ts';
import { processWebhookMessage } from '../skills/pipeline/index.ts';
import { Client } from '@notionhq/client';
import { loadNotionConfig } from '../skills/notion-sync/config.js';
import { createNotionDB } from '../skills/notion-search/db.js';
import { createEmbedder } from '../skills/notion-search/embedder.js';
import { createNotionSync } from '../skills/notion-sync/notion-sync.js';
import { createNotionSearcher, type NotionSearcher } from '../skills/notion-search/notion-search.js';
import { startNotionSyncScheduler } from '../skills/notion-sync/scheduler.js';

const BOT_NAME = process.env['BOT_NAME'] ?? 'Papi Chulo';

async function main(): Promise<void> {
  console.log(`\n🏠 ${BOT_NAME} starting up...\n`);

  const hostfullyClient = createHostfullyClient();
  const kbReader = createMultiPropertyKBReader(
    './knowledge-base/common.md',
    './knowledge-base/properties',
    './knowledge-base/property-map.json'
  );
  const threadTracker = createThreadTracker();

  // --- Notion Integration (optional, non-blocking) ---
  let notionSearch: NotionSearcher | undefined;
  let stopNotionScheduler: (() => void) | undefined;
  let closeNotionDB: (() => void) | undefined;

  const notionConfig = loadNotionConfig();
  if (notionConfig.token !== null) {
    try {
      const notionClient = new Client({ auth: notionConfig.token, notionVersion: '2026-03-11' });
      const db = createNotionDB(notionConfig.dbPath);
      closeNotionDB = () => { db.close(); };

      // Initialize embedding model asynchronously (downloads ~80MB on first run, cached after).
      // Model loading is intentionally non-blocking — the service starts accepting webhooks
      // immediately. Once loaded, notionSearch becomes available for all subsequent requests.
      void createEmbedder()
        .then((embedder) => {
          const sync = createNotionSync(notionClient, db, embedder, notionConfig);
          notionSearch = createNotionSearcher(db, embedder, {
            topK: notionConfig.topK,
            maxContextChars: notionConfig.maxContextChars,
          });
          const { stop } = startNotionSyncScheduler(sync, notionConfig.syncIntervalHours);
          stopNotionScheduler = stop;
          console.log('[NOTION] Notion search integration ready');
        })
        .catch((err: unknown) => {
          console.error('[NOTION] Failed to initialize embedding model:', (err as Error).message);
          console.warn('[NOTION] Running without Notion search');
        });
    } catch (err) {
      console.error('[NOTION] Initialization failed:', (err as Error).message);
      console.warn('[NOTION] Running without Notion integration');
    }
  }
  // --- End Notion Integration ---

  const slackApp = createSlackApp();
  const sifelyClient = createSifelyClient();
  const vlreHubClient = createVlreHubClient();
  registerAllHandlers(slackApp, hostfullyClient, threadTracker, sifelyClient);
  // Use a proxy so the KB assistant always reads the CURRENT notionSearch value at call time.
  // This ensures Notion context is available once the model finishes loading, even though
  // registerKBAssistantHandlers is called before createEmbedder() resolves.
  const notionSearchProxy = {
    search: async (query: string) => notionSearch ? notionSearch.search(query) : Promise.resolve([]),
    formatAsContext: (results: import('../skills/notion-search/notion-search.js').SearchResult[]) =>
      notionSearch ? notionSearch.formatAsContext(results) : '',
  } as unknown as import('../skills/notion-search/notion-search.js').NotionSearcher;
  registerKBAssistantHandlers(slackApp, kbReader, notionSearchProxy);
  await startSlackApp(slackApp);

  const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';
  startScheduler(slackApp, slackChannelId);
  startReminderScheduler(slackApp, slackChannelId, threadTracker);
  await slackApp.client.chat.postMessage({
    channel: slackChannelId,
    text: `✅ ${BOT_NAME} is back online`,
  });

  // pipelineContext uses a getter so processWebhookMessage reads the CURRENT value of
  // notionSearch at call time (not the value at context creation time).
  const pipelineContext = {
    hostfullyClient,
    kbReader,
    slackApp,
    slackChannelId,
    threadTracker,
    sifelyClient,
    vlreHubClient,
    get notionSearch() { return notionSearch; },
  };

  startWebhookReceiver((payload) => processWebhookMessage(payload, pipelineContext));

  console.log(`\n✅ ${BOT_NAME} is ready\n`);

  const postOfflineMessage = async (reason: string) => {
    try {
      await slackApp.client.chat.postMessage({
        channel: slackChannelId,
        text: `🔴 ${BOT_NAME} is going offline — ${reason}`,
      });
    } catch {
      // best-effort — don't block shutdown or crash recovery
    }
  };

  const shutdown = async (signal: string) => {
    console.log(`\n[${BOT_NAME}] ${signal} received — shutting down gracefully`);
    await postOfflineMessage('shutting down');
    stopNotionScheduler?.();
    closeNotionDB?.();
    stopScheduler();
    stopReminderScheduler();
    await stopSlackApp(slackApp);
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  process.on('uncaughtException', (err) => {
    console.error(`[${BOT_NAME}] Uncaught exception:`, err);
    void postOfflineMessage('crashed — uncaught exception').finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[${BOT_NAME}] Unhandled rejection:`, reason);
    void postOfflineMessage('crashed — unhandled rejection').finally(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error(`[${BOT_NAME}] Fatal startup error:`, err);
  process.exit(1);
});
