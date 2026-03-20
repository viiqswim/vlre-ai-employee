import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { appendToKB, undoAppend } from './kb-writer.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_DIR = join(tmpdir(), 'kb-writer-tests-' + Date.now());
let testFile: string;

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  testFile = join(TMP_DIR, 'test-kb-' + Date.now() + '.md');
});

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

describe('appendToKB', () => {
  test('creates file with Team Additions when file does not exist', async () => {
    const result = await appendToKB(testFile, 'WiFi password is ABC123');
    expect(result.success).toBe(true);
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, 'utf-8');
    expect(content).toContain('## Team Additions');
    expect(content).toContain('WiFi password is ABC123');
  });

  test('appends second entry under existing Team Additions', async () => {
    await appendToKB(testFile, 'First answer');
    await appendToKB(testFile, 'Second answer');
    const content = readFileSync(testFile, 'utf-8');
    expect((content.match(/## Team Additions/g) ?? []).length).toBe(1);
    expect(content).toContain('First answer');
    expect(content).toContain('Second answer');
  });

  test('throws EMPTY_ENTRY for empty entryText', async () => {
    await expect(appendToKB(testFile, '')).rejects.toThrow('EMPTY_ENTRY');
  });

  test('lineStart is a positive integer', async () => {
    const result = await appendToKB(testFile, 'Some entry');
    expect(result.lineStart).toBeGreaterThan(0);
  });

  test('appendToKB: pre-formatted entry (starts with ###) does not get double heading', async () => {
    const tmpFile = '/tmp/kb-writer-preformatted-test-' + Date.now() + '.md';
    const preformattedEntry = '### Appliances — Washer Brand\nThe washer is a Samsung.\nKeywords: washer, lavadora';
    const result = await appendToKB(tmpFile, preformattedEntry);
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).not.toContain('### ### ');
    expect(content).toContain('### Appliances — Washer Brand');
    expect(content).toContain('Samsung');
    await unlink(tmpFile).catch(() => {});
  });

  test('appendToKB: plain entry (no ###) still gets auto heading', async () => {
    const tmpFile = '/tmp/kb-writer-plain-test-' + Date.now() + '.md';
    const result = await appendToKB(tmpFile, 'Samsung');
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('### Samsung');
    await unlink(tmpFile).catch(() => {});
  });
});

describe('undoAppend', () => {
  test('removes exact appended text and returns true', async () => {
    const appendResult = await appendToKB(testFile, 'Entry to remove');
    expect(await undoAppend(testFile, appendResult.appendedText)).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).not.toContain('Entry to remove');
  });

  test('returns false when text not found', async () => {
    writeFileSync(testFile, '# KB\n\nContent.\n');
    expect(await undoAppend(testFile, 'nonexistent text')).toBe(false);
  });

  test('returns false when file does not exist', async () => {
    expect(await undoAppend('/tmp/nonexistent-kb-xyz.md', 'text')).toBe(false);
  });

  test('leaves other entries intact after undo', async () => {
    const first = await appendToKB(testFile, 'Keep this');
    const second = await appendToKB(testFile, 'Remove this');
    await undoAppend(testFile, second.appendedText);
    const content = readFileSync(testFile, 'utf-8');
    expect(content).toContain('Keep this');
    expect(content).not.toContain('Remove this');
  });
});