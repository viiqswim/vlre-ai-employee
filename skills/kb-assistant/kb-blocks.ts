import type { KnownBlock } from '@slack/types';

export function buildKBAnswerBlocks(question: string, answer: string, source: string, filePath: string): KnownBlock[] {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  const safeAnswer = answer.length > 500 ? answer.substring(0, 497) + '\u2026' : answer;
  const confirmValue = JSON.stringify({ question: q, answer: safeAnswer, source, filePath });
  const safeConfirmValue = confirmValue.length > 1990 ? JSON.stringify({ question: q.substring(0, 100) + '\u2026', answer: safeAnswer, source, filePath }) : confirmValue;
  const incorrectValue = JSON.stringify({ question: q, answer: safeAnswer, filePath });
  const safeIncorrectValue = incorrectValue.length > 1990 ? JSON.stringify({ question: q.substring(0, 100) + '\u2026', answer: safeAnswer, filePath }) : incorrectValue;
  return [
    { type: 'header', text: { type: 'plain_text', text: '📚 Knowledge Base Answer', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*Source:* ' + source }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: "Didn't find what you need? Ask in the thread and use 📝 Add Answer to update the KB." }] },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Correct', emoji: true },
          action_id: 'kb_confirm_answer',
          value: safeConfirmValue,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Not Quite', emoji: true },
          action_id: 'kb_incorrect_answer',
          value: safeIncorrectValue,
          style: 'danger',
        },
      ],
    },
  ];
}

export function buildKBDontKnowBlocks(question: string, threadTs: string, searchedFiles: string[]): KnownBlock[] {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: "🤔 I don't have this in my knowledge base", emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: "I searched but couldn't find an answer for:\n_" + q + '_' } },
  ];
  if (searchedFiles.length > 0) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '🔍 *Searched in:* ' + searchedFiles.join(', ') }] });
  }
  blocks.push(
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '📝 Add Answer', emoji: true }, action_id: 'kb_add_answer', value: JSON.stringify({ question: q, threadTs }), style: 'primary' }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'If you know the answer, click the button above to add it to our knowledge base.' }] },
  );
  return blocks;
}

export function buildKBAddAnswerModal(question: string, channelId: string, threadTs: string, messageTs: string): object {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  return {
    type: 'modal',
    callback_id: 'kb_add_answer_modal',
    private_metadata: JSON.stringify({ question: q, channelId, threadTs, messageTs }),
    title: { type: 'plain_text', text: 'Add to Knowledge Base', emoji: true },
    submit: { type: 'plain_text', text: 'Add Answer', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Question:* _' + q + '_' } },
      { type: 'input', block_id: 'answer_block', label: { type: 'plain_text', text: 'Answer', emoji: true }, element: { type: 'plain_text_input', action_id: 'answer_input', multiline: true, placeholder: { type: 'plain_text', text: 'Type the answer here. It will be added to the knowledge base.' } } },
    ],
  };
}

export function buildKBAddedConfirmBlocks(question: string, filePath: string, appendedText: string, storageLabel: string): KnownBlock[] {
  const preview = appendedText.length > 300 ? appendedText.substring(0, 297) + '\u2026' : appendedText;
  const undoValue = JSON.stringify({ filePath, appendedText });
  const safeUndoValue = undoValue.length > 1990 ? JSON.stringify({ filePath, appendedText: appendedText.substring(0, 500) + '\u2026' }) : undoValue;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: '\u2705 Added to knowledge base!' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: storageLabel }] },
    { type: 'section', text: { type: 'mrkdwn', text: '```\n' + preview + '\n```' } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '\u21a9\ufe0f Undo', emoji: true }, action_id: 'kb_undo_add', value: safeUndoValue, style: 'danger' }] },
  ];
}

export function buildKBUndoneBlocks(): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text: '\u21a9\ufe0f Entry removed from knowledge base.' } }];
}

export function buildKBConfirmedBlocks(question: string, answer: string, source: string, confirmedByUserId: string): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: '📚 Knowledge Base Answer', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*Source:* ' + source }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '✅ Confirmed by <@' + confirmedByUserId + '>' }] },
  ];
}

export function buildKBCorrectedBlocks(question: string, correction: string, filePath: string, correctedByUserId: string, storageLabel: string): KnownBlock[] {
  const preview = correction.length > 300 ? correction.substring(0, 297) + '\u2026' : correction;
  const undoValue = JSON.stringify({ filePath, appendedText: correction });
  const safeUndoValue = undoValue.length > 1990 ? JSON.stringify({ filePath, appendedText: correction.substring(0, 500) + '\u2026' }) : undoValue;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: '✏️ Correction saved to knowledge base by <@' + correctedByUserId + '>' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: storageLabel }] },
    { type: 'section', text: { type: 'mrkdwn', text: '```\n' + preview + '\n```' } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '\u21a9\ufe0f Undo', emoji: true }, action_id: 'kb_undo_add', value: safeUndoValue, style: 'danger' }] },
  ];
}

export function buildKBCorrectionModal(question: string, originalAnswer: string, channelId: string, messageTs: string, filePath: string): object {
  const q = question.length > 200 ? question.substring(0, 197) + '\u2026' : question;
  const origAnswer = originalAnswer.length > 500 ? originalAnswer.substring(0, 497) + '\u2026' : originalAnswer;
  const metadata = JSON.stringify({ question: q, originalAnswer: origAnswer, channelId, messageTs, filePath });
  const safeMetadata = metadata.length > 2900 ? JSON.stringify({ question: q.substring(0, 100) + '\u2026', originalAnswer: origAnswer.substring(0, 200) + '\u2026', channelId, messageTs, filePath }) : metadata;
  return {
    type: 'modal',
    callback_id: 'kb_correction_modal',
    private_metadata: safeMetadata,
    title: { type: 'plain_text', text: 'Submit Correction', emoji: true },
    submit: { type: 'plain_text', text: 'Submit Correction', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Question:* _' + q + '_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '*Current answer:*\n> ' + origAnswer } },
      { type: 'input', block_id: 'correction_block', label: { type: 'plain_text', text: 'Correct Answer', emoji: true }, element: { type: 'plain_text_input', action_id: 'correction_input', multiline: true, placeholder: { type: 'plain_text', text: 'Type the correct answer here.' } } },
    ],
  };
}
