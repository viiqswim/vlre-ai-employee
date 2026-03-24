/**
 * Startup configuration checks — warn-only, non-fatal.
 */

/**
 * Warns if CLAUDE_FALLBACK_TO_API is enabled but ANTHROPIC_API_KEY is missing.
 * The service should still start — the proxy might be fine.
 */
export function validateFallbackConfig(env: NodeJS.ProcessEnv = process.env): void {
  const fallbackEnabled = env['CLAUDE_FALLBACK_TO_API'] !== 'false'
  const apiKeySet = Boolean(env['ANTHROPIC_API_KEY'])

  if (fallbackEnabled && !apiKeySet) {
    console.log(
      '⚠️  WARNING: Claude API fallback is enabled but ANTHROPIC_API_KEY is not set. ' +
        'Proxy failures will NOT have a fallback — set ANTHROPIC_API_KEY in .env or ' +
        'disable fallback with CLAUDE_FALLBACK_TO_API=false'
    )
  }
}
