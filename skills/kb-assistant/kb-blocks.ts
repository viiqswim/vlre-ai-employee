import type { KnownBlock } from '@slack/types';

export function buildKBAnswerBlocks(question: string, answer: string, source: string): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: '📚 Knowledge Base Answer', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*Source:* ' + source }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: "Didn't find what you need? Ask in the thread and use 📝 Add Answer to update the KB." }] },
  ];
}

export function buildKBDontKnowBlocks(question: string, threadTs: string): KnownBlock[] {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  return [
    { type: 'header', text: { type: 'plain_text', text: "🤔 I don't have this in my knowledge base", emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: "I searched but couldn't find an answer for:\n_" + q + '_' } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '📝 Add Answer', emoji: true }, action_id: 'kb_add_answer', value: JSON.stringify({ question: q, threadTs }), style: 'primary' }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'If you know the answer, click the button above to add it to our knowledge base.' }] },
  ];
}

export function buildKBAddAnswerModal(question: string, channelId: string, threadTs: string): object {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  return {
    type: 'modal',
    callback_id: 'kb_add_answer_modal',
    private_metadata: JSON.stringify({ question: q, channelId, threadTs }),
    title: { type: 'plain_text', text: 'Add to Knowledge Base', emoji: true },
    submit: { type: 'plain_text', text: 'Add Answer', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Question:* _' + q + '_' } },
      { type: 'input', block_id: 'answer_block', label: { type: 'plain_text', text: 'Answer', emoji: true }, element: { type: 'plain_text_input', action_id: 'answer_input', multiline: true, placeholder: { type: 'plain_text', text: 'Type the answer here. It will be added to the knowledge base.' } } },
    ],
  };
}

export function buildKBAddedConfirmBlocks(question: string, filePath: string, appendedText: string): KnownBlock[] {
  const preview = appendedText.length > 300 ? appendedText.substring(0, 297) + '\u2026' : appendedText;
  const undoValue = JSON.stringify({ filePath, appendedText });
  const safeUndoValue = undoValue.length > 1990 ? JSON.stringify({ filePath, appendedText: appendedText.substring(0, 500) + '\u2026' }) : undoValue;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: '\u2705 Added to knowledge base!' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*File:* `' + filePath + '` \u203a Team Additions' }] },
    { type: 'section', text: { type: 'mrkdwn', text: '```\n' + preview + '\n```' } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '\u21a9\ufe0f Undo', emoji: true }, action_id: 'kb_undo_add', value: safeUndoValue, style: 'danger' }] },
  ];
}

export function buildKBUndoneBlocks(): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text: '\u21a9\ufe0f Entry removed from knowledge base.' } }];
}