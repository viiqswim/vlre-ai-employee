export type RetryConfig = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  _sleep?: (ms: number) => Promise<void>;
};

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && typeof error.message === 'string' && error.message.includes('fetch failed')) {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
      return true;
    }
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, config: Partial<RetryConfig> = {}): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 1000;
  const maxDelayMs = config.maxDelayMs ?? 8000;
  const sleep = config._sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown = new Error('withRetry: no attempts made');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxAttempts) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`[PIPELINE] Retry ${attempt}/${maxAttempts}: ${msg} (retrying in ${delay}ms)`);
      await sleep(delay);
    }
  }

  throw lastError;
}
