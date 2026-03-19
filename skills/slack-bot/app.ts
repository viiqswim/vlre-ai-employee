import { App, LogLevel } from '@slack/bolt';

export interface SlackBotConfig {
  botToken?: string;
  appToken?: string;
  channelId?: string;
}

export function createSlackApp(config: SlackBotConfig = {}): App {
  const botToken = config.botToken ?? process.env['SLACK_BOT_TOKEN'] ?? '';
  const appToken = config.appToken ?? process.env['SLACK_APP_TOKEN'] ?? '';

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Diagnostic: log all incoming Slack payloads (remove after issue resolved)
  app.use(async (args) => {
    const body = args.body as Record<string, unknown>;
    const event = body['event'] as Record<string, unknown> | undefined;
    if (event?.['type']) {
      console.log('[SLACK-DEBUG] event:', event['type'], '| channel:', event['channel'] ?? 'N/A');
    } else if (body['type']) {
      console.log('[SLACK-DEBUG] payload:', body['type']);
    }
    await args.next();
  });

  app.message('ping', async ({ message, say }) => {
    if (message.subtype === undefined) {
      await say('pong 🏓 OpenClaw is online!');
    }
  });

  app.error(async (error) => {
    console.error('[SLACK] App error:', error.message);
  });

  return app;
}

export async function startSlackApp(app: App): Promise<void> {
  await app.start();
  console.log('[SLACK] ⚡ Bolt app connected via Socket Mode');
}

export async function stopSlackApp(app: App): Promise<void> {
  await app.stop();
  console.log('[SLACK] Bolt app disconnected');
}
