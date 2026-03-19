import { describe, test, expect } from 'bun:test';
import { parseKBAnswer, detectPropertyInQuestion } from './kb-answerer.js';
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