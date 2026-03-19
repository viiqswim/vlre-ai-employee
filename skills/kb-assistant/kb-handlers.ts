import type { App } from '@slack/bolt';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MultiPropertyKBReader, PropertyMap } from '../kb-reader/multi-reader.js';
import { askKBAssistant, detectPropertyInQuestion } from './kb-answerer.js';
import { appendToKB, undoAppend } from './kb-writer.js';
import { buildKBAnswerBlocks, buildKBDontKnowBlocks, buildKBAddAnswerModal, buildKBAddedConfirmBlocks, buildKBUndoneBlocks } from './kb-blocks.js';

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
  const kbChannelId = process.env['SLACK_KB_CHANNEL_ID'] ?? '';
  if (!kbChannelId) { console.warn('[KB-ASSISTANT] SLACK_KB_CHANNEL_ID not set — KB assistant disabled'); return; }

  app.event('app_mention', async ({ event, client }) => {
    if (event.channel !== kbChannelId) return;
    if ('bot_id' in event && event.bot_id) return;
    const question = stripMention(event.text);
    if (!question) return;
    console.log('[KB-ASSISTANT] Question: "' + question.substring(0, 60) + '..." in channel ' + event.channel);
    try {
      const propertyMap = loadPropertyMap();
      const detectedProperty = detectPropertyInQuestion(question, propertyMap) ?? undefined;
      const kbContext = kbReader.search(question, detectedProperty);
      const result = await askKBAssistant(question, kbContext);
      if (result.found && result.answer) {
        await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, blocks: buildKBAnswerBlocks(question, result.answer, result.source ?? 'Knowledge Base'), text: result.answer });
        console.log('[KB-ASSISTANT] Answered: "' + question.substring(0, 60) + '..."');
      } else {
        await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, blocks: buildKBDontKnowBlocks(question, event.ts), text: "I don't have this info in my knowledge base." });
        console.log('[KB-ASSISTANT] Not found: "' + question.substring(0, 60) + '..."');
      }
    } catch (error) { console.error('[KB-ASSISTANT] app_mention handler error:', error); }
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

  console.log('[KB-ASSISTANT] Handlers registered (app_mention, kb_add_answer, kb_add_answer_modal, kb_undo_add)');
}