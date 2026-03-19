import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { parseKBAnswer, detectPropertyInQuestion, askKBAssistant, formatKBEntry } from './kb-answerer.js';
import type { PropertyMap } from '../kb-reader/multi-reader.js';

const SAMPLE_MAP: PropertyMap = {
  properties: [
    { code: '4403-hay', names: ['4403-HAY', '4403 Hayride', 'Hayride 4403', '4403 Hayride Ln'], address: '4403 Hayride Ln, Austin, TX', kbFile: 'properties/4403-hay.md' },
    { code: '3401-bre', names: ['3401-BRE', '3401 Breckenridge', 'Breckenridge', '3401 Breckenridge Dr'], address: '3401 Breckenridge Dr, Austin, TX 78744', kbFile: 'properties/3401-bre.md' },
  ],
};

describe('parseKBAnswer', () => {
  test("parses found=true response", () => {
    const result = parseKBAnswer('{"found": true, "answer": "WiFi is ABC123", "source": "common.md > WiFi"}');
    expect(result.found).toBe(true);
    expect(result.answer).toBe('WiFi is ABC123');
    expect(result.source).toBe('common.md > WiFi');
  });

  test("parses found=false response", () => {
    const result = parseKBAnswer('{"found": false, "answer": null, "source": null}');
    expect(result.found).toBe(false);
    expect(result.answer).toBeNull();
  });

  test("returns not-found for malformed JSON", () => {
    expect(parseKBAnswer('not json').found).toBe(false);
  });

  test("returns not-found for empty string", () => {
    expect(parseKBAnswer('').found).toBe(false);
  });
});

describe('detectPropertyInQuestion', () => {
  test("detects property by partial name", () => {
    expect(detectPropertyInQuestion('WiFi at Hayride 4403?', SAMPLE_MAP)).toBe('4403-HAY');
  });

  test("detects property by code", () => {
    expect(detectPropertyInQuestion('Tell me about 3401-BRE', SAMPLE_MAP)).toBe('3401-BRE');
  });

  test("detects property by address fragment", () => {
    expect(detectPropertyInQuestion('Rules at Breckenridge?', SAMPLE_MAP)).toBe('3401-BRE');
  });

  test("returns null when no property detected", () => {
    expect(detectPropertyInQuestion('What is the late checkout policy?', SAMPLE_MAP)).toBeNull();
  });

  test("returns null for empty question", () => {
    expect(detectPropertyInQuestion('', SAMPLE_MAP)).toBeNull();
  });
});

describe('askKBAssistant timeout', () => {
  const origFetch = globalThis.fetch;
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = origEnv;
  });

  test("uses CLAUDE_TIMEOUT_MS env var when set", async () => {
    process.env['CLAUDE_TIMEOUT_MS'] = '5000';
    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

    let capturedTimeoutMs = 0;
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: any, ms: number) => {
      capturedTimeoutMs = ms;
      return origSetTimeout(fn, ms);
    }) as any;

    (globalThis.fetch as any) = async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"found": false}' } }] }));
    };

    try {
      await askKBAssistant('test', 'context');
      expect(capturedTimeoutMs).toBe(5000);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  test("defaults to 30000ms when CLAUDE_TIMEOUT_MS not set", async () => {
    delete process.env['CLAUDE_TIMEOUT_MS'];
    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

    let capturedTimeoutMs = 0;
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: any, ms: number) => {
      capturedTimeoutMs = ms;
      return origSetTimeout(fn, ms);
    }) as any;

    (globalThis.fetch as any) = async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"found": false}' } }] }));
    };

    try {
      await askKBAssistant('test', 'context');
      expect(capturedTimeoutMs).toBe(30000);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  test("handles abort error gracefully", async () => {
    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

    (globalThis.fetch as any) = async () => {
      const error = new Error('The operation was aborted');
      (error as any).name = 'AbortError';
      throw error;
    };

    const result = await askKBAssistant('test question', 'test context');
    expect(result.found).toBe(false);
    expect(result.answer).toBeNull();
    expect(result.source).toBeNull();
  });
});

describe('formatKBEntry', () => {
  const origFetch = globalThis.fetch;
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = origEnv;
  });

  test("returns fallback when fetch throws", async () => {
    process.env['CLAUDE_MODE'] = 'proxy';
    process.env['CLAUDE_PROXY_URL'] = 'http://127.0.0.1:3456';

    (globalThis.fetch as any) = async () => {
      throw new Error('Network error');
    };

    const result = await formatKBEntry('¿Qué marca es la lavadora?', 'Samsung');
    expect(result).toContain('### Samsung');
    expect(result).toContain('Q: ¿Qué marca');
    expect(result).toContain('A: Samsung');
  });

  test("fallback includes question and answer", async () => {
    process.env['CLAUDE_MODE'] = 'api';
    delete process.env['ANTHROPIC_API_KEY'];

    const result = await formatKBEntry('What is the WiFi?', 'Network: Patitos-2g');
    expect(result).toBeTruthy();
    expect(result).toContain('WiFi');
    expect(result).toContain('Patitos');
  });
});