import { createSlackApp, startSlackApp, stopSlackApp } from '../skills/slack-bot/app.ts';
import { registerAllHandlers } from '../skills/slack-bot/handlers.ts';
import { createHostfullyClient } from '../skills/hostfully-client/index.ts';
import { createKBReader } from '../skills/kb-reader/index.ts';
import { createThreadTracker } from '../skills/thread-tracker/index.ts';
import { startWebhookReceiver } from './webhook-receiver.ts';
import { processWebhookMessage } from '../skills/pipeline/index.ts';

const BOT_NAME = process.env['BOT_NAME'] ?? 'Papi Chulo';

async function main(): Promise<void> {
  console.log(`\n🏠 ${BOT_NAME} starting up...\n`);

  const hostfullyClient = createHostfullyClient();
  const kbReader = createKBReader('./knowledge-base.md');
  const threadTracker = createThreadTracker();

  const slackApp = createSlackApp();
  registerAllHandlers(slackApp, hostfullyClient, threadTracker);
  await startSlackApp(slackApp);

  const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';
  const pipelineContext = { hostfullyClient, kbReader, slackApp, slackChannelId, threadTracker };

  startWebhookReceiver((payload) => processWebhookMessage(payload, pipelineContext));

  console.log(`\n✅ ${BOT_NAME} is ready\n`);

  const shutdown = async (signal: string) => {
    console.log(`\n[${BOT_NAME}] ${signal} received — shutting down gracefully`);
    await stopSlackApp(slackApp);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[${BOT_NAME}] Fatal startup error:`, err);
  process.exit(1);
});
