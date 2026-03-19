import type { App } from '@slack/bolt';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MultiPropertyKBReader, PropertyMap } from '../kb-reader/multi-reader.js';
import { askKBAssistant, detectPropertyInQuestion } from './kb-answerer.js';
import { appendToKB, undoAppend } from './kb-writer.js';
import { buildKBAnswerBlocks, buildKBDontKnowBlocks, buildKBAddAnswerModal, buildKBAddedConfirmBlocks, buildKBUndoneBlocks, buildKBConfirmedBlocks, buildKBCorrectedBlocks, buildKBCorrectionModal } from './kb-blocks.js';
import { recordFeedback } from './kb-feedback.js';
import type { KnownBlock } from '@slack/types';

const COMMON_KB_PATH = 'knowledge-base/common.md';
const PROPERTY_MAP_PATH = 'knowledge-base/property-map.json';
const PROPERTIES_DIR = 'knowledge-base/properties';

function loadPropertyMap(): PropertyMap {
  try {
    const p = resolve(PROPERTY_MAP_PATH);
    if (!existsSync(p)) return { properties: [] };
    return JSON.parse(readFileSync(p, 'utf-8')) as PropertyMap;
  } catch { return { properties: [] }; }
}

function resolveKBFilePath(question: string): string {
  const propertyMap = loadPropertyMap();
  const detected = detectPropertyInQuestion(question, propertyMap);
  if (detected) {
    const entry = propertyMap.properties.find((p) => p.names.some((n) => n === detected) || p.code === detected.toLowerCase());
    if (entry) return PROPERTIES_DIR + '/' + (entry.kbFile.split('/').pop() ?? '');
  }
  return COMMON_KB_PATH;
}

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

export function registerKBAssistantHandlers(app: App, kbReader: MultiPropertyKBReader): void {
  const kbChannelId = (process.env['SLACK_KB_CHANNEL_ID'] ?? '').trim().replace(/^[="']+|[="']+$/g, '');
  if (!kbChannelId) { console.warn('[KB-ASSISTANT] SLACK_KB_CHANNEL_ID not set — KB assistant disabled'); return; }

  app.event('app_mention', async ({ event, client }) => {
    console.log('[KB-ASSISTANT] app_mention received — channel: ' + event.channel + ' (expected: ' + kbChannelId + ')');
    if (event.channel !== kbChannelId) {
      console.warn('[KB-ASSISTANT] Ignoring event from channel ' + event.channel + ' — not the KB channel (' + kbChannelId + '). Check SLACK_KB_CHANNEL_ID in .env');
      return;
    }
    if ('bot_id' in event && event.bot_id) return;
    const question = stripMention(event.text);
    if (!question) return;
    console.log('[KB-ASSISTANT] Question: "' + question.substring(0, 60) + '..." in channel ' + event.channel);

    let thinkingTs: string | undefined;
    try {
      const thinkingMsg = await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: '🔍 Searching the knowledge base...',
      });
      thinkingTs = typeof thinkingMsg.ts === 'string' ? thinkingMsg.ts : undefined;
    } catch (e) {
      console.warn('[KB-ASSISTANT] Failed to post thinking indicator:', e);
    }

    const postOrUpdate = async (blocks: KnownBlock[], text: string) => {
      if (thinkingTs) {
        await client.chat.update({ channel: event.channel, ts: thinkingTs, blocks, text });
      } else {
        await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, blocks, text });
      }
    };

    try {
      const propertyMap = loadPropertyMap();
      const detectedProperty = detectPropertyInQuestion(question, propertyMap) ?? undefined;
      const kbContext = kbReader.search(question, detectedProperty);
      const result = await askKBAssistant(question, kbContext);

      const filePath = resolveKBFilePath(question);
      const searchedFiles: string[] = ['Common knowledge base'];
      if (detectedProperty !== undefined) {
        const pmEntry = propertyMap.properties.find((p) =>
          p.names.some((n) => n === detectedProperty) || p.code === detectedProperty.toLowerCase()
        );
        if (pmEntry) {
          searchedFiles.unshift(pmEntry.code.toUpperCase() + ' — ' + pmEntry.address);
        }
      }

      if (result.found && result.answer) {
        await postOrUpdate(buildKBAnswerBlocks(question, result.answer, result.source ?? 'Knowledge Base', filePath), result.answer);
        console.log('[KB-ASSISTANT] Answered: "' + question.substring(0, 60) + '..."');
      } else {
        await postOrUpdate(buildKBDontKnowBlocks(question, event.ts, searchedFiles), "I don't have this info in my knowledge base.");
        console.log('[KB-ASSISTANT] Not found: "' + question.substring(0, 60) + '..."');
      }
    } catch (error) {
      console.error('[KB-ASSISTANT] app_mention handler error:', error);
      const errorText = "⚠️ Couldn't reach the AI — please try again.";
      if (thinkingTs) {
        try { await client.chat.update({ channel: event.channel, ts: thinkingTs, text: errorText }); } catch { /* ignore */ }
      } else {
        try { await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, text: errorText }); } catch { /* ignore */ }
      }
    }
  });

  app.action('kb_add_answer', async ({ ack, body, client }) => {
    await ack();
    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    let question = '', threadTs = '';
    try { const p = JSON.parse(action?.value ?? '{}') as { question?: string; threadTs?: string }; question = p.question ?? ''; threadTs = p.threadTs ?? ''; }
    catch { console.error('[KB-ASSISTANT] kb_add_answer: failed to parse button value'); return; }
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? kbChannelId;
    try { await client.views.open({ trigger_id: triggerId, view: buildKBAddAnswerModal(question, channelId, threadTs) as Parameters<typeof client.views.open>[0]['view'] }); }
    catch (error) { console.error('[KB-ASSISTANT] kb_add_answer: failed to open modal:', error); }
  });

  app.view('kb_add_answer_modal', async ({ ack, body, client, view }) => {
    const answerText = (view.state.values['answer_block']?.['answer_input']?.value ?? '').trim();
    if (!answerText) { await ack({ response_action: 'errors', errors: { answer_block: 'Please provide an answer before submitting.' } }); return; }
    await ack();
    const userId = body.user.id;
    let question = '', channelId = kbChannelId, threadTs = '';
    try { const m = JSON.parse(view.private_metadata) as { question?: string; channelId?: string; threadTs?: string }; question = m.question ?? ''; channelId = m.channelId ?? kbChannelId; threadTs = m.threadTs ?? ''; }
    catch { console.error('[KB-ASSISTANT] kb_add_answer_modal: failed to parse private_metadata'); }
    try {
      const filePath = resolveKBFilePath(question);
      const appendResult = await appendToKB(filePath, answerText);
      await client.chat.postMessage({ channel: channelId, thread_ts: threadTs || undefined, blocks: buildKBAddedConfirmBlocks(question, filePath, appendResult.appendedText), text: '\u2705 Added to knowledge base!' });
      console.log('[KB-ASSISTANT] Answer added to ' + filePath + ' by ' + userId);
    } catch (error) {
      console.error('[KB-ASSISTANT] kb_add_answer_modal error:', error);
      await client.chat.postMessage({ channel: channelId, thread_ts: threadTs || undefined, text: '\u26a0\ufe0f Failed to save the answer. Please try again.' });
    }
  });

  app.action('kb_undo_add', async ({ ack, body, client }) => {
    await ack();
    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';
    let filePath = '', appendedText = '';
    try { const p = JSON.parse(action?.value ?? '{}') as { filePath?: string; appendedText?: string }; filePath = p.filePath ?? ''; appendedText = p.appendedText ?? ''; }
    catch { console.error('[KB-ASSISTANT] kb_undo_add: failed to parse button value'); return; }
    if (!filePath || !appendedText) { console.error('[KB-ASSISTANT] kb_undo_add: missing filePath or appendedText'); return; }
    try {
      const removed = await undoAppend(filePath, appendedText);
      if (removed) {
        if (channelId && messageTs) await client.chat.update({ channel: channelId, ts: messageTs, blocks: buildKBUndoneBlocks(), text: '\u21a9\ufe0f Entry removed from knowledge base.' });
        console.log('[KB-ASSISTANT] Undo by ' + userId + ': removed entry from ' + filePath);
      } else {
        await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Entry already removed or the file was modified manually.' });
      }
    } catch (error) { console.error('[KB-ASSISTANT] kb_undo_add error:', error); }
  });

  app.action('kb_confirm_answer', async ({ ack, body, client }) => {
    await ack();
    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';
    let question = '', answer = '', source = '', filePath = '';
    try {
      const p = JSON.parse(action?.value ?? '{}') as { question?: string; answer?: string; source?: string; filePath?: string };
      question = p.question ?? ''; answer = p.answer ?? ''; source = p.source ?? ''; filePath = p.filePath ?? '';
    } catch { console.error('[KB-ASSISTANT] kb_confirm_answer: failed to parse button value'); return; }
    recordFeedback({ type: 'correct', question, aiAnswer: answer, filePath, userId }).catch((e) =>
      console.error('[KB-ASSISTANT] kb_confirm_answer: feedback write failed:', e)
    );
    if (channelId && messageTs) {
      try {
        await client.chat.update({ channel: channelId, ts: messageTs, blocks: buildKBConfirmedBlocks(question, answer, source, userId), text: '✅ Answer confirmed' });
      } catch (e) { console.error('[KB-ASSISTANT] kb_confirm_answer: failed to update message:', e); }
    }
    console.log('[KB-ASSISTANT] Answer confirmed by ' + userId);
  });

  app.action('kb_incorrect_answer', async ({ ack, body, client }) => {
    await ack();  // MUST be first — trigger_id expires in 3s
    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';
    let question = '', answer = '', filePath = '';
    try {
      const p = JSON.parse(action?.value ?? '{}') as { question?: string; answer?: string; filePath?: string };
      question = p.question ?? ''; answer = p.answer ?? ''; filePath = p.filePath ?? '';
    } catch { console.error('[KB-ASSISTANT] kb_incorrect_answer: failed to parse button value'); return; }
    // Open correction modal IMMEDIATELY (trigger_id expires in 3s)
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildKBCorrectionModal(question, answer, channelId, messageTs, filePath) as Parameters<typeof client.views.open>[0]['view'],
      });
    } catch (e) { console.error('[KB-ASSISTANT] kb_incorrect_answer: failed to open modal:', e); }
    console.log('[KB-ASSISTANT] Correction modal opened by ' + body.user.id);
  });

  app.view('kb_correction_modal', async ({ ack, body, client, view }) => {
    const correctionText = (view.state.values['correction_block']?.['correction_input']?.value ?? '').trim();
    if (!correctionText) {
      await ack({ response_action: 'errors', errors: { correction_block: 'Please provide a correction before submitting.' } });
      return;
    }
    await ack();
    const userId = body.user.id;
    let question = '', originalAnswer = '', channelId = kbChannelId, messageTs = '', filePath = '';
    try {
      const m = JSON.parse(view.private_metadata) as { question?: string; originalAnswer?: string; channelId?: string; messageTs?: string; filePath?: string };
      question = m.question ?? ''; originalAnswer = m.originalAnswer ?? ''; channelId = m.channelId ?? kbChannelId; messageTs = m.messageTs ?? ''; filePath = m.filePath ?? COMMON_KB_PATH;
    } catch { console.error('[KB-ASSISTANT] kb_correction_modal: failed to parse private_metadata'); }
    try {
      const appendResult = await appendToKB(filePath, correctionText);
      recordFeedback({ type: 'incorrect', question, aiAnswer: originalAnswer, correction: correctionText, filePath, userId }).catch((e) =>
        console.error('[KB-ASSISTANT] kb_correction_modal: feedback write failed:', e)
      );
      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: buildKBCorrectedBlocks(question, appendResult.appendedText, filePath, userId),
          text: '✏️ Correction saved',
        });
      }
      console.log('[KB-ASSISTANT] Correction saved to ' + filePath + ' by ' + userId);
    } catch (error) {
      console.error('[KB-ASSISTANT] kb_correction_modal error:', error);
      if (channelId && messageTs) {
        try {
          await client.chat.postMessage({ channel: channelId, text: '⚠️ Failed to save the correction. Please try again.' });
        } catch { /* ignore */ }
      }
    }
  });

  console.log('[KB-ASSISTANT] Handlers registered (app_mention, kb_add_answer, kb_add_answer_modal, kb_undo_add, kb_confirm_answer, kb_incorrect_answer, kb_correction_modal)');
}
