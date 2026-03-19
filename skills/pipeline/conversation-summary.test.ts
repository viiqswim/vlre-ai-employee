import { describe, test, expect } from 'bun:test';
import { buildFallbackSummary } from './processor.js';

describe('buildFallbackSummary', () => {
  test('empty string → returns empty string', () => {
    expect(buildFallbackSummary('')).toBe('');
  });

  test('whitespace-only → returns empty string', () => {
    expect(buildFallbackSummary('   \n  ')).toBe('');
  });

  test('SYSTEM-only messages → returns empty string (filtered)', () => {
    const input = '[SYSTEM]: Booking confirmed\n[SYSTEM]: Check-in reminder sent';
    expect(buildFallbackSummary(input)).toBe('');
  });

  test('Guest + Host messages → humanized labels', () => {
    const input = '[GUEST]: What is the WiFi?\n[PROPERTY_MANAGER]: Check the welcome sheet';
    expect(buildFallbackSummary(input)).toBe('Guest: What is the WiFi?\nHost: Check the welcome sheet');
  });

  test('TRAVELER sender treated as Guest', () => {
    const input = '[TRAVELER]: Can I check in early?';
    expect(buildFallbackSummary(input)).toBe('Guest: Can I check in early?');
  });

  test('mixed SYSTEM + real messages → SYSTEM filtered out', () => {
    const input = '[SYSTEM]: Auto-confirmation\n[GUEST]: Hi there\n[PROPERTY_MANAGER]: Welcome!';
    expect(buildFallbackSummary(input)).toBe('Guest: Hi there\nHost: Welcome!');
  });

  test('long input → truncated at 400 chars with ellipsis', () => {
    const longLine = '[GUEST]: ' + 'x'.repeat(410);
    const result = buildFallbackSummary(longLine);
    expect(result.length).toBeLessThanOrEqual(400);
    expect(result.endsWith('…')).toBe(true);
  });

  test('fallback fires when Claude returns null', () => {
    const conversationHistory = '[GUEST]: Hello there';
    const claudeSummary: string | null = null;
    const resolved = claudeSummary || (conversationHistory.trim() ? buildFallbackSummary(conversationHistory) : null);
    expect(resolved).toBe('Guest: Hello there');
  });

  test('fallback fires when Claude returns empty string (|| not ??)', () => {
    const conversationHistory = '[GUEST]: Hello there';
    const claudeSummary: string | null = '';
    const resolved = claudeSummary || (conversationHistory.trim() ? buildFallbackSummary(conversationHistory) : null);
    expect(resolved).toBe('Guest: Hello there');
  });

  test("Claude's summary used as-is when non-empty", () => {
    const conversationHistory = '[GUEST]: Hello there';
    const claudeSummary = 'Guest asked about something. Host replied.';
    const resolved = claudeSummary || (conversationHistory.trim() ? buildFallbackSummary(conversationHistory) : null);
    expect(resolved).toBe('Guest asked about something. Host replied.');
  });
});
