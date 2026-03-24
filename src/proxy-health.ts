import net from 'node:net';

/**
 * Checks if a TCP port is reachable.
 * Same logic as isPortOpen() in start.ts.
 */
export function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export interface ProxyHealthMonitorHandle {
  stop(): void;
}

/**
 * Starts a background interval that monitors the proxy port.
 * Logs when the proxy transitions from up→down and down→up.
 * Does NOT spam logs on consecutive same-state checks.
 * Uses setInterval with .unref() so it doesn't block process exit.
 */
export function startProxyHealthMonitor(
  host: string,
  port: number,
  options?: {
    intervalMs?: number;
    _checkFn?: (host: string, port: number) => Promise<boolean>;
  }
): ProxyHealthMonitorHandle {
  const intervalMs = options?.intervalMs ?? 30_000;
  const checkFn = options?._checkFn ?? isPortOpen;

  let wasUp = true; // Assume up at start (proxy was just checked to be running)

  const timer = setInterval(async () => {
    const isUp = await checkFn(host, port);
    if (!isUp && wasUp) {
      console.log(`⚠️  Claude proxy is DOWN on :${port} — API fallback is active`);
      wasUp = false;
    } else if (isUp && !wasUp) {
      console.log(`✅ Claude proxy recovered on :${port}`);
      wasUp = true;
    }
  }, intervalMs);

  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
