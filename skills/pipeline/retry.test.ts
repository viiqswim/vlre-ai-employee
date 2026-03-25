import { test, expect, describe } from 'bun:test';
import { isRetryableError, withRetry } from './retry';

describe('isRetryableError', () => {
  describe('HTTP 5xx errors', () => {
    test('503 Service Unavailable is retryable', () => {
      const error = new Error('Hostfully API error: 503 Service Unavailable');
      expect(isRetryableError(error)).toBe(true);
    });

    test('500 Internal Server Error is retryable', () => {
      const error = new Error('Hostfully API error: 500 Internal Server Error');
      expect(isRetryableError(error)).toBe(true);
    });

    test('502 Bad Gateway is retryable', () => {
      const error = new Error('OpenRouter API error: 502 Bad Gateway');
      expect(isRetryableError(error)).toBe(true);
    });

    test('5xx with authentication failed is NOT retryable', () => {
      const error = new Error('Hostfully API authentication failed (500)');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('HTTP 429 rate limit errors', () => {
    test('429 in parentheses is retryable', () => {
      const error = new Error('Hostfully API rate limit exceeded (429)');
      expect(isRetryableError(error)).toBe(true);
    });

    test('rate limit keyword is retryable', () => {
      const error = new Error('OpenRouter rate limit exceeded');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('HTTP auth errors (NOT retryable)', () => {
    test('401 authentication failed is NOT retryable', () => {
      const error = new Error('Hostfully API authentication failed (401)');
      expect(isRetryableError(error)).toBe(false);
    });

    test('403 authentication failed is NOT retryable', () => {
      const error = new Error('OpenRouter authentication failed (403)');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('Network-level errors (existing behavior)', () => {
    test('fetch failed TypeError is retryable', () => {
      const error = new TypeError('fetch failed');
      expect(isRetryableError(error)).toBe(true);
    });

    test('AbortError is retryable', () => {
      const error = new Error('AbortError');
      error.name = 'AbortError';
      expect(isRetryableError(error)).toBe(true);
    });

    test('ECONNREFUSED is retryable', () => {
      const error = new Error('ECONNREFUSED: Connection refused');
      expect(isRetryableError(error)).toBe(true);
    });

    test('ECONNRESET is retryable', () => {
      const error = new Error('ECONNRESET: Connection reset by peer');
      expect(isRetryableError(error)).toBe(true);
    });

    test('ETIMEDOUT is retryable', () => {
      const error = new Error('ETIMEDOUT: Connection timed out');
      expect(isRetryableError(error)).toBe(true);
    });

    test('random error is NOT retryable', () => {
      const error = new Error('random error');
      expect(isRetryableError(error)).toBe(false);
    });
  });
});

describe('withRetry', () => {
  test('retries on 5xx errors and succeeds on 3rd attempt', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Hostfully API error: 503 Service Unavailable');
      }
      return 'success';
    };

    const result = await withRetry(fn, { _sleep: async () => {} });
    expect(result).toBe('success');
    expect(callCount).toBe(3);
  });

  test('does NOT retry on 401 auth errors', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error('Hostfully API authentication failed (401)');
    };

    try {
      await withRetry(fn, { _sleep: async () => {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error instanceof Error && error.message.includes('authentication failed')).toBe(true);
      expect(callCount).toBe(1);
    }
  });

  test('retries on 429 rate limit errors', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('Hostfully API rate limit exceeded (429)');
      }
      return 'success';
    };

    const result = await withRetry(fn, { _sleep: async () => {} });
    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });

  test('respects maxAttempts config', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error('Hostfully API error: 503 Service Unavailable');
    };

    try {
      await withRetry(fn, { maxAttempts: 2, _sleep: async () => {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(callCount).toBe(2);
    }
  });
});
