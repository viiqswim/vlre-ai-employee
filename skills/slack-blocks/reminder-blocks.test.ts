import { test, expect } from 'bun:test';
import { buildReminderBlocks, formatElapsedTime, type ReminderThread } from './reminder-blocks.ts';
import type { KnownBlock } from '@slack/types';

test('formatElapsedTime: minutes < 60', () => {
  expect(formatElapsedTime(32)).toBe('32 min');
  expect(formatElapsedTime(45)).toBe('45 min');
  expect(formatElapsedTime(1)).toBe('1 min');
  expect(formatElapsedTime(59)).toBe('59 min');
});

test('formatElapsedTime: minutes >= 60', () => {
  expect(formatElapsedTime(60)).toBe('1h 0min');
  expect(formatElapsedTime(90)).toBe('1h 30min');
  expect(formatElapsedTime(150)).toBe('2h 30min');
  expect(formatElapsedTime(1440)).toBe('24h 0min');
  expect(formatElapsedTime(121)).toBe('2h 1min');
});

test('buildReminderBlocks: single thread compact format', () => {
  const threads: ReminderThread[] = [
    {
      threadUid: 'thread-1',
      guestName: 'John Doe',
      propertyName: '7213 Nutria Run',
      elapsedMinutes: 45,
      permalink: 'https://slack.com/archives/C123/p1234567890',
    },
  ];

  const blocks = buildReminderBlocks(threads);

  expect(blocks.length).toBeLessThanOrEqual(5);

  const allText = JSON.stringify(blocks);

  expect(allText).toContain('John Doe');
  expect(allText).toContain('7213 Nutria Run');
  expect(allText).toContain('45 min');
  expect(allText).toContain('https://slack.com/archives/C123/p1234567890');
  expect(allText).toContain('View');

  const headerBlock = blocks[0] as KnownBlock;
  expect(headerBlock.type).toBe('header');
});

test('buildReminderBlocks: three threads all info present', () => {
  const threads: ReminderThread[] = [
    {
      threadUid: 'thread-1',
      guestName: 'Alice',
      propertyName: 'Property A',
      elapsedMinutes: 30,
      permalink: 'https://slack.com/archives/C123/p1111111111',
    },
    {
      threadUid: 'thread-2',
      guestName: 'Bob',
      propertyName: 'Property B',
      elapsedMinutes: 60,
      permalink: 'https://slack.com/archives/C123/p2222222222',
    },
    {
      threadUid: 'thread-3',
      guestName: 'Charlie',
      propertyName: 'Property C',
      elapsedMinutes: 120,
      permalink: 'https://slack.com/archives/C123/p3333333333',
    },
  ];

  const blocks = buildReminderBlocks(threads);

  expect(blocks.length).toBeLessThanOrEqual(50);

  const allText = JSON.stringify(blocks);

  expect(allText).toContain('Alice');
  expect(allText).toContain('Bob');
  expect(allText).toContain('Charlie');
  expect(allText).toContain('Property A');
  expect(allText).toContain('Property B');
  expect(allText).toContain('Property C');
  expect(allText).toContain('https://slack.com/archives/C123/p1111111111');
  expect(allText).toContain('https://slack.com/archives/C123/p2222222222');
  expect(allText).toContain('https://slack.com/archives/C123/p3333333333');
  expect(allText).toContain('30 min');
  expect(allText).toContain('1h 0min');
  expect(allText).toContain('2h 0min');
});

test('buildReminderBlocks: 25 threads stays under 50 blocks', () => {
  const threads: ReminderThread[] = Array.from({ length: 25 }, (_, i) => ({
    threadUid: `t${i}`,
    guestName: `Guest ${i}`,
    propertyName: `Property ${i}`,
    elapsedMinutes: 30 + i,
    permalink: `https://slack.com/p${i}`,
  }));

  const blocks = buildReminderBlocks(threads);

  expect(blocks.length).toBeLessThanOrEqual(50);
});

test('buildReminderBlocks: 100 threads stays under 50 blocks and all guests present', () => {
  const threads: ReminderThread[] = Array.from({ length: 100 }, (_, i) => ({
    threadUid: `t${i}`,
    guestName: `Guest ${i}`,
    propertyName: `Property ${i}`,
    elapsedMinutes: 30 + i,
    permalink: `https://slack.com/p${i}`,
  }));

  const blocks = buildReminderBlocks(threads);

  expect(blocks.length).toBeLessThanOrEqual(50);

  const allText = JSON.stringify(blocks);

  expect(allText).toContain('Guest 0');
  expect(allText).toContain('Guest 99');
});

test('buildReminderBlocks: empty array returns valid blocks', () => {
  const blocks = buildReminderBlocks([]);

  expect(blocks.length).toBeLessThanOrEqual(5);
  expect(blocks.length).toBeGreaterThan(0);

  const headerBlock = blocks[0] as KnownBlock;
  expect(headerBlock.type).toBe('header');
});

test('buildReminderBlocks: escapes special characters in names', () => {
  const threads: ReminderThread[] = [
    {
      threadUid: 'thread-1',
      guestName: 'John & Jane <Doe>',
      propertyName: 'Property & Co. <Main>',
      elapsedMinutes: 45,
      permalink: 'https://slack.com/p1',
    },
  ];

  const blocks = buildReminderBlocks(threads);

  const allText = JSON.stringify(blocks);

  expect(allText).toContain('&amp;');
  expect(allText).toContain('&lt;');
  expect(allText).toContain('&gt;');

  // Verify no raw unescaped & followed by a letter
  const rawAmpMatch = allText.match(/&(?!amp;|lt;|gt;)[a-zA-Z]/);
  expect(rawAmpMatch).toBeNull();
});
