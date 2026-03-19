import { App, LogLevel, SocketModeReceiver } from '@slack/bolt';

export interface SlackBotConfig {
  botToken?: string;
  appToken?: string;
  channelId?: string;
}

export function createSlackApp(config: SlackBotConfig = {}): App {
  const botToken = config.botToken ?? process.env['SLACK_BOT_TOKEN'] ?? '';
  const appToken = config.appToken ?? process.env['SLACK_APP_TOKEN'] ?? '';

  // Use explicit SocketModeReceiver so we can configure ping/pong timeouts.
  // Default clientPingTimeout is 5s — too short when proxy calls take 15-30s.
  // When the pong is delayed, Slack marks the connection unhealthy and silently drops
  // subsequent events (bolt-js #2196, bolt-python #1246).
  const receiver = new SocketModeReceiver({
    appToken,
    logLevel: LogLevel.WARN,
  });

  // Increase ping/pong timeouts. These are plain JS properties set during SocketModeClient
  // construction; they are read at start() time when the WebSocket is created.
  // TypeScript marks them private but they're accessible at runtime.
  // @ts-expect-error — clientPingTimeoutMS is private in TS but plain property in JS
  receiver.client.clientPingTimeoutMS = 30000; // up from default 5000ms
  // @ts-expect-error — serverPingTimeoutMS is private in TS but plain property in JS
  receiver.client.serverPingTimeoutMS = 60000; // up from default 30000ms

  // Log Socket Mode connection lifecycle so disconnects are visible in terminal.
  receiver.client.on('connected', () => console.log('[SLACK] Socket Mode connected'));
  receiver.client.on('connecting', () => console.log('[SLACK] Socket Mode connecting...'));
  receiver.client.on('reconnecting', () => console.warn('[SLACK] Socket Mode reconnecting — events may be delayed'));
  receiver.client.on('disconnected', () => console.warn('[SLACK] Socket Mode disconnected — will attempt reconnect'));

  const app = new App({
    token: botToken,
    receiver,
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
  console.log('[SLACK] ⚡ Socket Mode WebSocket connected');
  // Slack takes 10-30s after WebSocket connect to activate event routing on their side.
  // Without this wait, the first messages sent to the bot are silently dropped by Slack.
  // SLACK_WARMUP_MS defaults to 15000 (15s) — increase if first messages still drop.
  const warmupMs = parseInt(process.env['SLACK_WARMUP_MS'] ?? '15000', 10);
  if (warmupMs > 0) {
    console.log(`[SLACK] Waiting ${warmupMs / 1000}s for Slack event routing to activate...`);
    await new Promise<void>((resolve) => setTimeout(resolve, warmupMs));
  }
  console.log('[SLACK] ⚡ Bolt app ready — event routing active');
}

export async function stopSlackApp(app: App): Promise<void> {
  await app.stop();
  console.log('[SLACK] Bolt app disconnected');
}
