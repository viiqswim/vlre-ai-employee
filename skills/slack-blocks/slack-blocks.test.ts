import { test, expect } from 'bun:test';
import {
  buildApprovalBlocks,
  buildApprovedBlocks,
  buildRejectedBlocks,
  buildSupersededBlocks,
  buildEditedBlocks,
  buildErrorBlocks,
  buildEditModal,
  formatChannel,
  formatConfidence,
  type ApprovalMessageParams,
  type PostActionContext,
} from './blocks';

const mockParams: ApprovalMessageParams = {
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
  urgency: false,
};

const mockContext: PostActionContext = {
  guestName: 'John Doe',
  propertyName: 'Downtown Loft',
  checkInDate: '2024-03-20',
  checkOutDate: '2024-03-25',
  threadUid: 'thread-456',
  leadUid: 'lead-789',
};

function makeParams(overrides: Partial<ApprovalMessageParams> = {}): ApprovalMessageParams {
  return {
    guestName: 'John Smith',
    propertyName: 'Test Property',
    checkInDate: '2026-03-20',
    checkOutDate: '2026-03-25',
    nightCount: 5,
    channel: 'AIRBNB',
    guestMessage: 'Test message',
    draftResponse: 'Test response',
    confidence: 0.9,
    classification: 'NEEDS_APPROVAL',
    summary: 'Test summary',
    conversationSummary: null,
    messageUid: 'msg-001',
    threadUid: 'thread-001',
    leadUid: 'lead-001',
    urgency: false,
    ...overrides,
  };
}

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
  const blocks = buildApprovedBlocks('U123456', 'Thanks for your message!', mockContext);
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
  const blocks = buildRejectedBlocks('U123456', mockContext);
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
  const blocks = buildEditedBlocks('U123456', 'Edited response text', mockContext);
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

type ModalView = {
  type: string;
  callback_id: string;
  title?: { text: string };
  blocks?: Array<{ type: string; element?: { initial_value?: string } }>;
};

test('buildEditModal returns modal view object', () => {
  const modal = buildEditModal({
    draftResponse: 'Test response',
    channelId: 'C123456',
    messageTs: '1234567890.123456',
    threadUid: 'thread-456',
    leadUid: 'lead-789',
    messageUid: 'msg-123',
  }) as ModalView;
  
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
  }) as ModalView;
  
  const inputBlock = modal.blocks?.find(b => b.type === 'input');
  expect(inputBlock).toBeDefined();
  if (inputBlock?.type === 'input') {
    expect(inputBlock.element?.initial_value).toBe(draftText);
  }
});

test('buildSupersededBlocks returns array with superseded message', () => {
  const blocks = buildSupersededBlocks();
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThan(0);
  
  const sectionBlock = blocks.find(b => b.type === 'section');
  expect(sectionBlock).toBeDefined();
  if (sectionBlock?.type === 'section') {
    expect(sectionBlock.text?.text).toContain('⏭️');
    expect(sectionBlock.text?.text).toContain('Superseded');
  }
});

test('buildSupersededBlocks returns exactly one block', () => {
  const blocks = buildSupersededBlocks();
  expect(blocks.length).toBe(1);
});

test('buildApprovedBlocks with context contains guest name in context block', () => {
  const blocks = buildApprovedBlocks('U999', 'Great, confirmed!', mockContext);
  const allText = blocks
    .filter(b => b.type === 'context')
    .flatMap(b => b.type === 'context' ? (b.elements ?? []) : [])
    .map(e => ('text' in e ? e.text : ''))
    .join(' ');
  expect(allText).toContain('John Doe');
});

test('buildApprovedBlocks with context contains Hostfully link', () => {
  const blocks = buildApprovedBlocks('U999', 'Confirmed!', mockContext);
  const allText = blocks
    .filter(b => b.type === 'context')
    .flatMap(b => b.type === 'context' ? (b.elements ?? []) : [])
    .map(e => ('text' in e ? e.text : ''))
    .join(' ');
  expect(allText).toContain('hostfully.com');
  expect(allText).toContain('thread-456');
  expect(allText).toContain('lead-789');
});

test('buildRejectedBlocks with context contains property name', () => {
  const blocks = buildRejectedBlocks('U999', mockContext);
  const allText = blocks
    .filter(b => b.type === 'context')
    .flatMap(b => b.type === 'context' ? (b.elements ?? []) : [])
    .map(e => ('text' in e ? e.text : ''))
    .join(' ');
  expect(allText).toContain('Downtown Loft');
});

test('buildApprovalBlocks with urgency:true — header starts with 🚨 URGENT', () => {
  const blocks = buildApprovalBlocks(makeParams({ urgency: true }));
  const headerBlock = blocks.find(b => b.type === 'header');
  expect(headerBlock).toBeDefined();
  if (headerBlock?.type === 'header') {
    expect(headerBlock.text?.text).toMatch(/^🚨 URGENT/);
  }
});

test('buildApprovalBlocks with urgency:false — header starts with 🏠 New Guest Message', () => {
  const blocks = buildApprovalBlocks(makeParams({ urgency: false }));
  const headerBlock = blocks.find(b => b.type === 'header');
  expect(headerBlock).toBeDefined();
  if (headerBlock?.type === 'header') {
    expect(headerBlock.text?.text).toMatch(/^🏠 New Guest Message/);
  }
});

test('buildApprovalBlocks with urgency:true — blocks contain "immediate attention"', () => {
  const blocks = buildApprovalBlocks(makeParams({ urgency: true }));
  const allText = blocks
    .map(b => {
      if (b.type === 'section' && b.text) return b.text.text;
      return '';
    })
    .join(' ');
  expect(allText).toContain('immediate attention');
});

test('buildApprovalBlocks button value payload size < 2000 chars (worst-case inputs)', () => {
  const worstCase = makeParams({
    guestName: 'A'.repeat(50),
    propertyName: 'B'.repeat(50),
    checkInDate: '2026-12-31',
    checkOutDate: '2026-12-31',
    messageUid: 'msg-' + 'x'.repeat(36),
    threadUid: 'thread-' + 'x'.repeat(36),
    leadUid: 'lead-' + 'x'.repeat(36),
    draftResponse: 'D'.repeat(2000),
  });
  const blocks = buildApprovalBlocks(worstCase);
  const actionsBlock = blocks.find(b => b.type === 'actions');
  expect(actionsBlock).toBeDefined();
  if (actionsBlock?.type === 'actions') {
    for (const el of actionsBlock.elements ?? []) {
      if ('value' in el && typeof el.value === 'string') {
        expect(el.value.length).toBeLessThan(2000);
      }
    }
  }
});

test('buildEditModal private_metadata contains draftResponse', () => {
  const draftText = 'This is a draft response for the modal.';
  const modal = buildEditModal({
    draftResponse: draftText,
    channelId: 'C123456',
    messageTs: '1234567890.123456',
    threadUid: 'thread-456',
    leadUid: 'lead-789',
    messageUid: 'msg-123',
  }) as { private_metadata: string };

  expect(typeof modal.private_metadata).toBe('string');
  const parsed = JSON.parse(modal.private_metadata) as { draftResponse?: string };
  expect(parsed.draftResponse).toBe(draftText);
});
