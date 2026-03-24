export function validateOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env['OPENROUTER_API_KEY']) {
    console.log(
      '⚠️  WARNING: OPENROUTER_API_KEY is not set — all AI classification calls will fail. ' +
        'Set OPENROUTER_API_KEY in .env'
    )
  }
}
