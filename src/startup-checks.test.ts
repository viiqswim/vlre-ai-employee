import { describe, test, expect, spyOn, mock } from 'bun:test'
import { validateOpenRouterConfig, validateOpenRouterApiKey } from './startup-checks.ts'

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

describe('validateOpenRouterApiKey', () => {
  const validEnv = { OPENROUTER_API_KEY: 'sk-or-test-key' }

  test('resolves when API returns 200', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }))
    )
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('throws auth error on 401 without retrying', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 401 })))
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).rejects.toThrow(/invalid or unauthorized/i)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('throws auth error on 403 without retrying', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 403 })))
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).rejects.toThrow(/invalid or unauthorized/i)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('retries on 500 and resolves when second call returns 200', async () => {
    const mockFetch = mock()
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 500 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }))
      )
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('throws after exhausting 3 retries on persistent 500', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 500 })))
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  test('throws without calling fetch when OPENROUTER_API_KEY is missing', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    await expect(
      validateOpenRouterApiKey(
        { OPENROUTER_API_KEY: undefined },
        { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 }
      )
    ).rejects.toThrow(/not set/i)
    expect(mockFetch).toHaveBeenCalledTimes(0)
  })

  test('retries on network error and throws after 3 attempts', async () => {
    const mockFetch = mock(() => Promise.reject(new TypeError('fetch failed')))
    await expect(
      validateOpenRouterApiKey(validEnv, { _fetch: mockFetch as unknown as typeof fetch, _retryDelayMs: 0 })
    ).rejects.toThrow(/fetch failed/i)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})
