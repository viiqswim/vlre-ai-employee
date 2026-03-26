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

test('buildReminderBlocks: single thread', () => {
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

  // Should have: header, timestamp context, section, footer context = 4 blocks
  expect(blocks.length).toBe(4);

  // First block is header
  const headerBlock = blocks[0] as KnownBlock;
  expect(headerBlock.type).toBe('header');
  if (headerBlock.type === 'header' && headerBlock.text?.type === 'plain_text') {
    expect(headerBlock.text.text).toContain('1 Unresponded Message(s)');
  }

  // Second block is timestamp context
  const timestampBlock = blocks[1] as KnownBlock;
  expect(timestampBlock.type).toBe('context');

  // Third block is section with guest info
  const sectionBlock = blocks[2] as KnownBlock;
  expect(sectionBlock.type).toBe('section');
  if (sectionBlock.type === 'section' && sectionBlock.text?.type === 'mrkdwn') {
    expect(sectionBlock.text.text).toContain('John Doe');
    expect(sectionBlock.text.text).toContain('7213 Nutria Run');
    expect(sectionBlock.text.text).toContain('45 min');
  }

  // Check button accessory
  if (sectionBlock.type === 'section' && sectionBlock.accessory?.type === 'button') {
    expect(sectionBlock.accessory.url).toBe('https://slack.com/archives/C123/p1234567890');
    if (sectionBlock.accessory.text?.type === 'plain_text') {
      expect(sectionBlock.accessory.text.text).toBe('View Message');
    }
  }

  // Fourth block is footer context
  const footerBlock = blocks[3] as KnownBlock;
  expect(footerBlock.type).toBe('context');
});

test('buildReminderBlocks: three threads with dividers', () => {
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

  // Should have: header, timestamp context, section, divider, section, divider, section, footer context = 8 blocks
  expect(blocks.length).toBe(8);

  // Header contains "3"
  const headerBlock = blocks[0] as KnownBlock;
  if (headerBlock.type === 'header' && headerBlock.text?.type === 'plain_text') {
    expect(headerBlock.text.text).toContain('3 Unresponded Message(s)');
  }

  // Check dividers are at positions 3 and 5 (between sections)
  expect(blocks[3]?.type).toBe('divider');
  expect(blocks[5]?.type).toBe('divider');

  // Check all three sections have permalinks
  const section1 = blocks[2] as KnownBlock;
  const section2 = blocks[4] as KnownBlock;
  const section3 = blocks[6] as KnownBlock;

  if (section1.type === 'section' && section1.accessory?.type === 'button') {
    expect(section1.accessory.url).toBe('https://slack.com/archives/C123/p1111111111');
  }
  if (section2.type === 'section' && section2.accessory?.type === 'button') {
    expect(section2.accessory.url).toBe('https://slack.com/archives/C123/p2222222222');
  }
  if (section3.type === 'section' && section3.accessory?.type === 'button') {
    expect(section3.accessory.url).toBe('https://slack.com/archives/C123/p3333333333');
  }
});

test('buildReminderBlocks: empty array', () => {
  const blocks = buildReminderBlocks([]);

  // Should still have: header, timestamp context, footer context = 3 blocks
  expect(blocks.length).toBe(3);

  const headerBlock = blocks[0] as KnownBlock;
  if (headerBlock.type === 'header' && headerBlock.text?.type === 'plain_text') {
    expect(headerBlock.text.text).toContain('0 Unresponded Message(s)');
  }
});

test('buildReminderBlocks: escapes special characters in guest/property names', () => {
  const threads: ReminderThread[] = [
    {
      threadUid: 'thread-1',
      guestName: 'John & Jane <Doe>',
      propertyName: 'Property & Co. <Main>',
      elapsedMinutes: 45,
      permalink: 'https://slack.com/archives/C123/p1234567890',
    },
  ];

  const blocks = buildReminderBlocks(threads);
  const sectionBlock = blocks[2] as KnownBlock;

  if (sectionBlock.type === 'section' && sectionBlock.text?.type === 'mrkdwn') {
    const text = sectionBlock.text.text;
    // Should contain escaped versions
    expect(text).toContain('&amp;');
    expect(text).toContain('&lt;');
    expect(text).toContain('&gt;');
  }
});
