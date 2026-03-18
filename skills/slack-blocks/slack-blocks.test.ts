import { test, expect } from 'bun:test';
import {
  buildApprovalBlocks,
  buildApprovedBlocks,
  buildRejectedBlocks,
  buildEditedBlocks,
  buildErrorBlocks,
  buildEditModal,
  formatChannel,
  formatConfidence,
} from './blocks';

const mockParams = {
  guestName: 'John Doe',
  propertyName: 'Downtown Loft',
  checkInDate: '2024-03-20',
  checkOutDate: '2024-03-25',
  nightCount: 5,
  channel: 'AIRBNB',
  guestMessage: 'Hi, can I check in early?',
  draftResponse: 'Sure, we can arrange early check-in for you.',
  confidence: 0.85,
  classification: 'Check-in Request',
  summary: 'Guest requesting early check-in',
  conversationSummary: 'Previous messages about booking',
  messageUid: 'msg-123',
  threadUid: 'thread-456',
  leadUid: 'lead-789',
};

test('buildApprovalBlocks returns array with header block containing property name', () => {
  const blocks = buildApprovalBlocks(mockParams);
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const headerBlock = blocks.find(b => b.type === 'header');
  expect(headerBlock).toBeDefined();
  expect(headerBlock?.type === 'header' && headerBlock.text?.type === 'plain_text').toBe(true);
  if (headerBlock?.type === 'header') {
    expect(headerBlock.text?.text).toContain('Downtown Loft');
  }
});

test('buildApprovalBlocks includes conversation summary section when non-null', () => {
  const blocks = buildApprovalBlocks(mockParams);
  const conversationSection = blocks.find(
    b => b.type === 'section' && 'text' in b && b.text?.text?.includes('Conversation so far')
  );
  expect(conversationSection).toBeDefined();
});

test('buildApprovalBlocks omits conversation summary section when null', () => {
  const paramsWithoutConversation = { ...mockParams, conversationSummary: null };
  const blocks = buildApprovalBlocks(paramsWithoutConversation);
  const conversationSection = blocks.find(
    b => b.type === 'section' && 'text' in b && b.text?.text?.includes('Conversation so far')
  );
  expect(conversationSection).toBeUndefined();
});

test('buildApprovalBlocks includes "View in Hostfully" button with correct URL', () => {
  const blocks = buildApprovalBlocks(mockParams);
  const actionsBlock = blocks.find(b => b.type === 'actions');
  expect(actionsBlock).toBeDefined();
  
  if (actionsBlock?.type === 'actions') {
    const hostfullyButton = actionsBlock.elements?.find(
      e => 'action_id' in e && e.action_id === 'view_in_hostfully'
    );
    expect(hostfullyButton).toBeDefined();
    if (hostfullyButton && 'url' in hostfullyButton) {
      expect(hostfullyButton.url).toContain('thread-456');
      expect(hostfullyButton.url).toContain('lead-789');
      expect(hostfullyButton.url).toContain('https://platform.hostfully.com/app/#/inbox');
    }
  }
});

test('buildApprovalBlocks truncates draftResponse in metadata to 1500 chars', () => {
  const longResponse = 'a'.repeat(2000);
  const paramsWithLongResponse = { ...mockParams, draftResponse: longResponse };
  const blocks = buildApprovalBlocks(paramsWithLongResponse);
  const actionsBlock = blocks.find(b => b.type === 'actions');
  
  if (actionsBlock?.type === 'actions') {
    const approveButton = actionsBlock.elements?.find(
      e => 'action_id' in e && e.action_id === 'approve_response'
    );
    if (approveButton && 'value' in approveButton) {
      const metadata = JSON.parse(approveButton.value as string);
      expect(metadata.draftResponse.length).toBeLessThanOrEqual(1500);
    }
  }
});

test('formatChannel("AIRBNB") returns "🏠 Airbnb"', () => {
  expect(formatChannel('AIRBNB')).toBe('🏠 Airbnb');
});

test('formatChannel("VRBO") returns "🏡 VRBO"', () => {
  expect(formatChannel('VRBO')).toBe('🏡 VRBO');
});

test('formatChannel("BOOKING_COM") returns "🌐 Booking.com"', () => {
  expect(formatChannel('BOOKING_COM')).toBe('🌐 Booking.com');
});

test('formatChannel("DIRECT") returns "📧 Direct"', () => {
  expect(formatChannel('DIRECT')).toBe('📧 Direct');
});

test('formatChannel with unknown channel returns original channel', () => {
  expect(formatChannel('UNKNOWN')).toBe('UNKNOWN');
});

test('formatConfidence(0.9) returns string containing "✅"', () => {
  const result = formatConfidence(0.9);
  expect(result).toContain('✅');
  expect(result).toContain('90%');
});

test('formatConfidence(0.65) returns string containing "⚠️"', () => {
  const result = formatConfidence(0.65);
  expect(result).toContain('⚠️');
  expect(result).toContain('65%');
});

test('formatConfidence(0.3) returns string containing "🔴"', () => {
  const result = formatConfidence(0.3);
  expect(result).toContain('🔴');
  expect(result).toContain('30%');
});

test('buildApprovedBlocks returns array with approval message', () => {
  const blocks = buildApprovedBlocks('U123456', 'Thanks for your message!');
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const sectionBlock = blocks.find(b => b.type === 'section');
  expect(sectionBlock).toBeDefined();
  if (sectionBlock?.type === 'section') {
    expect(sectionBlock.text?.text).toContain('✅');
    expect(sectionBlock.text?.text).toContain('Approved');
  }
});

test('buildRejectedBlocks returns array with rejection message', () => {
  const blocks = buildRejectedBlocks('U123456');
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const sectionBlock = blocks.find(b => b.type === 'section');
  expect(sectionBlock).toBeDefined();
  if (sectionBlock?.type === 'section') {
    expect(sectionBlock.text?.text).toContain('❌');
    expect(sectionBlock.text?.text).toContain('Rejected');
  }
});

test('buildEditedBlocks returns array with edit message', () => {
  const blocks = buildEditedBlocks('U123456', 'Edited response text');
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const sectionBlock = blocks.find(b => b.type === 'section');
  expect(sectionBlock).toBeDefined();
  if (sectionBlock?.type === 'section') {
    expect(sectionBlock.text?.text).toContain('✏️');
    expect(sectionBlock.text?.text).toContain('Edited and sent');
  }
});

test('buildErrorBlocks returns array with error message', () => {
  const blocks = buildErrorBlocks('API connection failed');
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const sectionBlock = blocks.find(b => b.type === 'section');
  expect(sectionBlock).toBeDefined();
  if (sectionBlock?.type === 'section') {
    expect(sectionBlock.text?.text).toContain('🚨');
    expect(sectionBlock.text?.text).toContain('Send failed');
    expect(sectionBlock.text?.text).toContain('API connection failed');
  }
});

test('buildEditModal returns modal view object', () => {
  const modal = buildEditModal({
    draftResponse: 'Test response',
    channelId: 'C123456',
    messageTs: '1234567890.123456',
    threadUid: 'thread-456',
    leadUid: 'lead-789',
    messageUid: 'msg-123',
  });
  
  expect(modal).toBeDefined();
  expect(modal.type).toBe('modal');
  expect(modal.callback_id).toBe('edit_response_modal');
  expect(modal.title?.text).toBe('Edit Response');
  expect(Array.isArray(modal.blocks)).toBe(true);
});

test('buildEditModal includes initial_value with draftResponse', () => {
  const draftText = 'This is my draft response';
  const modal = buildEditModal({
    draftResponse: draftText,
    channelId: 'C123456',
    messageTs: '1234567890.123456',
    threadUid: 'thread-456',
    leadUid: 'lead-789',
    messageUid: 'msg-123',
  });
  
  const inputBlock = modal.blocks?.find(b => b.type === 'input');
  expect(inputBlock).toBeDefined();
  if (inputBlock?.type === 'input') {
    expect(inputBlock.element?.initial_value).toBe(draftText);
  }
});
