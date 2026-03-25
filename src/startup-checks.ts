export function validateOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env['OPENROUTER_API_KEY']) {
    console.log(
      '⚠️  WARNING: OPENROUTER_API_KEY is not set — all AI classification calls will fail. ' +
        'Set OPENROUTER_API_KEY in .env'
    )
  }
}

export async function validateOpenRouterApiKey(
  env: NodeJS.ProcessEnv = process.env,
  options?: { _retryDelayMs?: number; _fetch?: typeof fetch },
): Promise<void> {
  const apiKey = env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set — cannot validate');
  }

  const baseUrl = (env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const url = `${baseUrl}/key`;
  const fetchFn = options?._fetch ?? fetch;
  const maxAttempts = 3;
  const retryDelayMs = options?._retryDelayMs ?? 2000;
  const timeoutMs = 5000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `OpenRouter API key is invalid or unauthorized (${response.status}) — check OPENROUTER_API_KEY in .env`
          );
        }
        if (!response.ok) {
          throw new Error(`OpenRouter API returned ${response.status} during validation — will retry`);
        }
        return;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error;
      const isAuthError =
        error instanceof Error &&
        (error.message.includes('invalid or unauthorized') ||
          error.message.includes('401') ||
          error.message.includes('403'));
      if (isAuthError) throw error;
      if (attempt < maxAttempts) {
        await new Promise<void>((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastError;
}
