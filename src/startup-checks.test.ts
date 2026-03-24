import { describe, test, expect, spyOn } from 'bun:test'
import { validateOpenRouterConfig } from './startup-checks.ts'

describe('validateOpenRouterConfig', () => {
  test('warns when OPENROUTER_API_KEY is missing', () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
    validateOpenRouterConfig({ OPENROUTER_API_KEY: undefined })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const msg = consoleSpy.mock.calls[0]?.[0] as string
    expect(msg).toMatch(/OPENROUTER_API_KEY/)
    expect(msg).toMatch(/WARNING/i)
    consoleSpy.mockRestore()
  })

  test('is silent when OPENROUTER_API_KEY is set', () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})
    validateOpenRouterConfig({ OPENROUTER_API_KEY: 'sk-or-test-key' })
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
