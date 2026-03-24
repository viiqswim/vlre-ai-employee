import { describe, test, expect, spyOn } from 'bun:test'
import { validateFallbackConfig } from './startup-checks.ts'

describe('validateFallbackConfig', () => {
  test('warns when fallback enabled and API key missing', () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
    validateFallbackConfig({ CLAUDE_FALLBACK_TO_API: undefined, ANTHROPIC_API_KEY: undefined })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const msg = consoleSpy.mock.calls[0]?.[0] as string
    expect(msg).toMatch(/ANTHROPIC_API_KEY/)
    expect(msg).toMatch(/WARNING/i)
    consoleSpy.mockRestore()
  })

  test('is silent when API key is set', () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
    validateFallbackConfig({ CLAUDE_FALLBACK_TO_API: undefined, ANTHROPIC_API_KEY: 'sk-test-key' })
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  test('is silent when fallback explicitly disabled', () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
    validateFallbackConfig({ CLAUDE_FALLBACK_TO_API: 'false', ANTHROPIC_API_KEY: undefined })
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
