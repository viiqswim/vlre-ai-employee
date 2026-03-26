import type { App } from '@slack/bolt';
import { loadRules, updateRule, invalidateCache } from '../pipeline/rules-store.js';
import { appendToKB } from '../kb-assistant/kb-writer.js';
import {
  buildLearningConfirmationBlocks,
  buildLearningEditModal,
  buildLearningActionedBlocks,
} from '../slack-blocks/learning-blocks.js';
import { appendAuditLog } from './handlers.js';

export function registerLearningHandlers(app: App): void {
  app.action('confirm_learning', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    // Parse proposalId from value
    let proposalId: string;
    try {
      proposalId =
        (JSON.parse(action?.value ?? '{}') as { proposalId?: string }).proposalId ?? '';
    } catch {
      console.error('[LEARNING] confirm_learning: failed to parse value');
      return;
    }
    if (!proposalId) {
      console.error('[LEARNING] confirm_learning: missing proposalId');
      return;
    }

    const rule = loadRules().find((r) => r.id === proposalId);
    if (!rule) {
      console.warn('[LEARNING] confirm_learning: rule not found — id=' + proposalId);
      return;
    }

    if (rule.status !== 'proposed') {
      if (channelId) {
        await client.chat
          .postEphemeral({
            channel: channelId,
            user: userId,
            text: 'This learning proposal was already handled by another team member.',
          })
          .catch(() => {});
      }
      return;
    }

    try {
      if (rule.type === 'knowledge') {
        const kbPath = rule.kbFilePath ?? 'knowledge-base/common.md';
        const appendResult = await appendToKB(kbPath, rule.correction);
        await updateRule(proposalId, {
          status: 'confirmed',
          confirmedAt: new Date().toISOString(),
          kbAppendedText: appendResult.appendedText,
        });
      } else {
        await updateRule(proposalId, {
          status: 'confirmed',
          confirmedAt: new Date().toISOString(),
        });
      }
      invalidateCache();

      if (channelId && messageTs) {
        await client.chat
          .update({
            channel: channelId,
            ts: messageTs,
            blocks: buildLearningActionedBlocks('confirmed', userId),
            text: `✅ Learning confirmed by <@${userId}>`,
          })
          .catch((e: unknown) => {
            console.warn(
              '[LEARNING] confirm_learning: could not update message: ' +
                (e instanceof Error ? e.message : String(e)),
            );
          });
      }

      appendAuditLog({
        action: 'learning_confirmed',
        userId,
        proposalId,
        type: rule.type,
        kbFilePath: rule.kbFilePath,
      });
      console.log('[LEARNING] Proposal ' + proposalId + ' confirmed by ' + userId);
    } catch (error) {
      console.error('[LEARNING] confirm_learning error:', error);
    }
  });

  app.action('reject_learning', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let proposalId: string;
    try {
      proposalId =
        (JSON.parse(action?.value ?? '{}') as { proposalId?: string }).proposalId ?? '';
    } catch {
      console.error('[LEARNING] reject_learning: failed to parse value');
      return;
    }
    if (!proposalId) {
      console.error('[LEARNING] reject_learning: missing proposalId');
      return;
    }

    const rule = loadRules().find((r) => r.id === proposalId);
    if (!rule) {
      console.warn('[LEARNING] reject_learning: rule not found — id=' + proposalId);
      return;
    }

    if (rule.status !== 'proposed') {
      if (channelId) {
        await client.chat
          .postEphemeral({
            channel: channelId,
            user: userId,
            text: 'This learning proposal was already handled by another team member.',
          })
          .catch(() => {});
      }
      return;
    }

    try {
      await updateRule(proposalId, { status: 'rejected' });
      invalidateCache();

      if (channelId && messageTs) {
        await client.chat
          .update({
            channel: channelId,
            ts: messageTs,
            blocks: buildLearningActionedBlocks('rejected', userId),
            text: `❌ Learning rejected by <@${userId}>`,
          })
          .catch((e: unknown) => {
            console.warn(
              '[LEARNING] reject_learning: could not update message: ' +
                (e instanceof Error ? e.message : String(e)),
            );
          });
      }

      appendAuditLog({ action: 'learning_rejected', userId, proposalId });
      console.log('[LEARNING] Proposal ' + proposalId + ' rejected by ' + userId);
    } catch (error) {
      console.error('[LEARNING] reject_learning error:', error);
    }
  });

  app.action('edit_learning', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let proposalId: string;
    try {
      proposalId =
        (JSON.parse(action?.value ?? '{}') as { proposalId?: string }).proposalId ?? '';
    } catch {
      return;
    }
    if (!proposalId || !triggerId) return;

    const rule = loadRules().find((r) => r.id === proposalId);
    if (!rule) {
      console.warn('[LEARNING] edit_learning: rule not found');
      return;
    }

    if (rule.status !== 'proposed') {
      if (channelId) {
        await client.chat
          .postEphemeral({
            channel: channelId,
            user: userId,
            text: 'This learning proposal was already handled.',
          })
          .catch(() => {});
      }
      return;
    }

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildLearningEditModal(
          rule,
          channelId,
          messageTs,
        ) as Parameters<typeof client.views.open>[0]['view'],
      });
    } catch (error) {
      console.error('[LEARNING] edit_learning: failed to open modal:', error);
    }
  });

  app.view('edit_learning_modal', async ({ ack, body, client, view }) => {
    await ack();

    const userId = body.user.id;
    const refinedText = (
      view.state.values['learning_text_block']?.['learning_text_input']?.value ?? ''
    ).trim();

    let metadata: { proposalId: string; channelId: string; messageTs: string };
    try {
      metadata = JSON.parse(view.private_metadata) as typeof metadata;
    } catch {
      console.error('[LEARNING] edit_learning_modal: failed to parse private_metadata');
      return;
    }

    const { proposalId, channelId, messageTs } = metadata;
    if (!proposalId || !refinedText) return;

    const rule = loadRules().find((r) => r.id === proposalId);
    if (!rule) {
      console.warn('[LEARNING] edit_learning_modal: rule not found');
      return;
    }
    if (rule.status !== 'proposed') {
      if (channelId) {
        await client.chat
          .postEphemeral({
            channel: channelId,
            user: userId,
            text: 'This proposal was already handled.',
          })
          .catch(() => {});
      }
      return;
    }

    try {
      await updateRule(proposalId, { correction: refinedText });
      invalidateCache();

      const updatedRule = loadRules().find((r) => r.id === proposalId);
      if (updatedRule && channelId && messageTs) {
        await client.chat
          .update({
            channel: channelId,
            ts: messageTs,
            blocks: buildLearningConfirmationBlocks(updatedRule),
            text: '🧠 Learning proposal updated — please review',
          })
          .catch((e: unknown) => {
            console.warn(
              '[LEARNING] edit_learning_modal: could not update message: ' +
                (e instanceof Error ? e.message : String(e)),
            );
          });
      }
      console.log('[LEARNING] Proposal ' + proposalId + ' refined by ' + userId);
    } catch (error) {
      console.error('[LEARNING] edit_learning_modal error:', error);
    }
  });
}
