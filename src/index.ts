import { createSlackApp, startSlackApp, stopSlackApp } from '../skills/slack-bot/app.ts';
import { registerAllHandlers } from '../skills/slack-bot/handlers.ts';
import { createHostfullyClient } from '../skills/hostfully-client/index.ts';
import { createThreadTracker } from '../skills/thread-tracker/index.ts';
import { startWebhookReceiver } from './webhook-receiver.ts';

const BOT_NAME = process.env['BOT_NAME'] ?? 'Papi Chulo';

async function main(): Promise<void> {
  console.log(`\n🏠 ${BOT_NAME} v2 starting up...\n`);

  const hostfullyClient = createHostfullyClient();
  const threadTracker = createThreadTracker();

  const slackApp = createSlackApp();
  registerAllHandlers(slackApp, hostfullyClient, threadTracker);
  await startSlackApp(slackApp);

  startWebhookReceiver();

  console.log(`\n✅ ${BOT_NAME} v2 is ready\n`);

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
