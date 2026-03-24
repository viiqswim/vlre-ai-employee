import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { LearnedRule } from '../pipeline/learned-rules.js';
import {
  updateRule,
  addRule,
  getConfirmedRules,
  invalidateCache,
  loadRules,
} from '../pipeline/rules-store.js';
import {
  buildRuleActionedRecapBlocks,
  buildAddRuleModal,
  buildRemoveRuleModal,
  buildRefineRuleModal,
  buildRefinedRuleReviewBlocks,
} from '../slack-blocks/recap-blocks.js';
import { refineRuleWithClaude } from '../pipeline/rule-refiner.js';

export function registerRuleHandlers(app: App): void {
  app.action('approve_rule', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let ruleId: string;
    try {
      ruleId = (JSON.parse(action?.value ?? '{}') as { ruleId?: string }).ruleId ?? '';
    } catch {
      console.error('[RULES] approve_rule: failed to parse value');
      return;
    }

    if (!ruleId) {
      console.error('[RULES] approve_rule: missing ruleId');
      return;
    }

    try {
      const updated = await updateRule(ruleId, {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
      if (!updated) {
        console.warn('[RULES] approve_rule: rule not found');
        return;
      }

      invalidateCache();

      const message = (body as { message?: { blocks?: KnownBlock[] } }).message;
      if (message?.blocks && channelId && messageTs) {
        const updatedBlocks = buildRuleActionedRecapBlocks(
          message.blocks,
          ruleId,
          'approved',
          userId,
        );
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: '📊 Weekly Rules Recap (updated)',
          });
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          console.warn('[RULES] approve_rule: could not update recap message (non-blocking): ' + msg);
        }
      }

      console.log('[RULES] Rule ' + ruleId + ' confirmed by ' + userId);
    } catch (error) {
      console.error('[RULES] approve_rule error:', error);
    }
  });

  app.action('reject_rule', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let ruleId: string;
    try {
      ruleId = (JSON.parse(action?.value ?? '{}') as { ruleId?: string }).ruleId ?? '';
    } catch {
      console.error('[RULES] reject_rule: failed to parse value');
      return;
    }

    if (!ruleId) {
      console.error('[RULES] reject_rule: missing ruleId');
      return;
    }

    try {
      const updated = await updateRule(ruleId, { status: 'rejected' });
      if (!updated) {
        console.warn('[RULES] reject_rule: rule not found');
        return;
      }

      invalidateCache();

      const message = (body as { message?: { blocks?: KnownBlock[] } }).message;
      if (message?.blocks && channelId && messageTs) {
        const updatedBlocks = buildRuleActionedRecapBlocks(
          message.blocks,
          ruleId,
          'rejected',
          userId,
        );
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: '📊 Weekly Rules Recap (updated)',
          });
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          console.warn('[RULES] reject_rule: could not update recap message (non-blocking): ' + msg);
        }
      }

      console.log('[RULES] Rule ' + ruleId + ' rejected by ' + userId);
    } catch (error) {
      console.error('[RULES] reject_rule error:', error);
    }
  });

  app.action('add_custom_rule', async ({ ack, body, client }) => {
    await ack();

    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    if (!triggerId) {
      console.error('[RULES] add_custom_rule: missing trigger_id');
      return;
    }

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildAddRuleModal() as Parameters<typeof client.views.open>[0]['view'],
      });
    } catch (error) {
      console.error('[RULES] add_custom_rule: failed to open modal:', error);
    }
  });

  app.action('remove_rule', async ({ ack, body, client }) => {
    await ack();

    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    if (!triggerId) {
      console.error('[RULES] remove_rule: missing trigger_id');
      return;
    }

    try {
      const confirmedRules = getConfirmedRules();
      await client.views.open({
        trigger_id: triggerId,
        view: buildRemoveRuleModal(confirmedRules) as Parameters<typeof client.views.open>[0]['view'],
      });
    } catch (error) {
      console.error('[RULES] remove_rule: failed to open modal:', error);
    }
  });

  app.view('add_rule_modal', async ({ ack, body, client }) => {
    const pattern = (
      body.view.state.values['pattern_block']?.['pattern_input']?.value ?? ''
    ).trim();
    const correction = (
      body.view.state.values['correction_block']?.['correction_input']?.value ?? ''
    ).trim();

    if (!pattern || !correction) {
      await ack({
        response_action: 'errors',
        errors: {
          ...(pattern ? {} : { pattern_block: 'Pattern is required' }),
          ...(correction ? {} : { correction_block: 'Correction is required' }),
        },
      });
      return;
    }

    await ack();

    const userId = body.user.id;
    const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';

    const newRule: LearnedRule = {
      id: 'rule-' + Date.now() + '-custom',
      pattern,
      correction,
      examples: [],
      frequency: 0,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    };

    try {
      await addRule(newRule);
      invalidateCache();
      if (slackChannelId) {
        await client.chat.postMessage({
          channel: slackChannelId,
          text: '📝 Custom rule added by <@' + userId + '>: _' + correction.substring(0, 100) + '_',
        });
      }
      console.log('[RULES] Custom rule added by ' + userId + ': ' + pattern);
    } catch (error) {
      if (error instanceof Error && error.message === 'DUPLICATE_PATTERN') {
        console.warn('[RULES] add_rule_modal: duplicate pattern rejected');
        // Can't ack again with errors after already ack'd — just log it
      } else {
        console.error('[RULES] add_rule_modal error:', error);
      }
    }
  });

  app.view('remove_rule_modal', async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;
    const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';
    const selectedOptions =
      body.view.state.values['remove_rules_block']?.['rules_to_remove']?.selected_options ?? [];
    const ruleIds = selectedOptions.map((opt: { value: string }) => opt.value);

    if (ruleIds.length === 0) return;

    for (const id of ruleIds) {
      await updateRule(id, { status: 'rejected' });
    }
    invalidateCache();

    if (slackChannelId) {
      await client.chat.postMessage({
        channel: slackChannelId,
        text: '🗑️ ' + ruleIds.length + ' rule(s) deactivated by <@' + userId + '>',
      });
    }

    console.log(
      '[RULES] ' +
        ruleIds.length +
        ' rule(s) deactivated by ' +
        userId +
        ': ' +
        ruleIds.join(', '),
    );
  });

  app.action('refine_rule', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let ruleId: string;
    try {
      ruleId = (JSON.parse(action?.value ?? '{}') as { ruleId?: string }).ruleId ?? '';
    } catch {
      console.error('[RULES] refine_rule: failed to parse value');
      return;
    }

    if (!ruleId) {
      console.error('[RULES] refine_rule: missing ruleId');
      return;
    }

    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    if (!triggerId) {
      console.error('[RULES] refine_rule: missing trigger_id');
      return;
    }

    const rule = loadRules().find((r) => r.id === ruleId);
    if (!rule) {
      console.error('[RULES] refine_rule: rule not found — id=' + ruleId);
      return;
    }

    try {
      // Open modal before any async DB work — trigger_id expires in 3s
      await client.views.open({
        trigger_id: triggerId,
        view: buildRefineRuleModal(rule) as Parameters<typeof client.views.open>[0]['view'],
      });

      await updateRule(ruleId, { status: 'pending_refinement' });
      invalidateCache();

      const message = (body as { message?: { blocks?: KnownBlock[] } }).message;
      if (message?.blocks && channelId && messageTs) {
        const updatedBlocks = buildRuleActionedRecapBlocks(message.blocks, ruleId, 'rejected', userId);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: '🧠 Rule notification (updated)',
          });
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          console.warn('[RULES] refine_rule: could not update recap message (non-blocking): ' + msg);
        }
      }

      console.log('[RULES] Rule ' + ruleId + ' set to pending_refinement by ' + userId);
    } catch (error) {
      console.error('[RULES] refine_rule error:', error);
    }
  });

  app.view('refine_rule_modal', async ({ ack, body, client }) => {
    const refinedText = (
      body.view.state.values['rule_text_block']?.['rule_text_input']?.value ?? ''
    ).trim();
    const conditions = (
      body.view.state.values['conditions_block']?.['conditions_input']?.value ?? ''
    ).trim();

    if (!refinedText) {
      await ack({
        response_action: 'errors',
        errors: { rule_text_block: 'Rule text is required' },
      });
      return;
    }

    await ack();

    const userId = body.user.id;
    const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';

    let metadata: { ruleId: string; originalCorrection: string; originalPattern: string; originalStatus: string };
    try {
      metadata = JSON.parse(body.view.private_metadata) as typeof metadata;
    } catch {
      console.error('[RULES] refine_rule_modal: failed to parse private_metadata');
      return;
    }

    const { ruleId, originalCorrection, originalPattern, originalStatus } = metadata;

    const currentRule = loadRules().find((r) => r.id === ruleId);
    if (!currentRule || currentRule.status !== 'pending_refinement') {
      console.warn('[RULES] refine_rule_modal: rule not in pending_refinement state — skipping');
      if (slackChannelId) {
        await client.chat.postEphemeral({
          channel: slackChannelId,
          user: userId,
          text: 'This rule was already processed by another team member.',
        });
      }
      return;
    }

    const rewritten = await refineRuleWithClaude({
      originalPattern,
      originalCorrection,
      refinedText,
      conditions,
      scope: currentRule.scope ?? 'global',
    });

    if (!rewritten) {
      await updateRule(ruleId, { status: originalStatus as LearnedRule['status'] });
      invalidateCache();
      console.error('[RULES] refine_rule_modal: Claude rewrite failed, reverted rule ' + ruleId);
      if (slackChannelId) {
        await client.chat.postEphemeral({
          channel: slackChannelId,
          user: userId,
          text: 'Failed to rewrite rule — Claude returned an error. The original rule has been restored.',
        });
      }
      return;
    }

    await updateRule(ruleId, {
      pattern: rewritten.pattern,
      correction: rewritten.correction,
      scope: rewritten.scope,
      conditions,
    });
    invalidateCache();

    if (slackChannelId) {
      await client.chat.postMessage({
        channel: slackChannelId,
        blocks: buildRefinedRuleReviewBlocks(
          { pattern: originalPattern, correction: originalCorrection },
          rewritten,
          conditions,
          userId,
          ruleId,
        ),
        text: '✏️ Rule refined — please review',
      });
    }

    console.log('[RULES] Rule ' + ruleId + ' rewritten by ' + userId + ': "' + rewritten.correction + '"');
  });

  app.action('accept_refined_rule', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let ruleId: string;
    try {
      ruleId = (JSON.parse(action?.value ?? '{}') as { ruleId?: string }).ruleId ?? '';
    } catch {
      console.error('[RULES] accept_refined_rule: failed to parse value');
      return;
    }

    if (!ruleId) {
      console.error('[RULES] accept_refined_rule: missing ruleId');
      return;
    }

    try {
      const updated = await updateRule(ruleId, {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
      if (!updated) {
        console.warn('[RULES] accept_refined_rule: rule not found');
        return;
      }

      invalidateCache();

      const message = (body as { message?: { blocks?: KnownBlock[] } }).message;
      if (message?.blocks && channelId && messageTs) {
        const updatedBlocks = buildRuleActionedRecapBlocks(message.blocks, ruleId, 'approved', userId);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: '✏️ Refined rule review (updated)',
          });
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          console.warn('[RULES] accept_refined_rule: could not update recap message (non-blocking): ' + msg);
        }
      }

      console.log('[RULES] Refined rule ' + ruleId + ' accepted by ' + userId);
    } catch (error) {
      console.error('[RULES] accept_refined_rule error:', error);
    }
  });

  app.action('reject_refined_rule', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    let ruleId: string;
    try {
      ruleId = (JSON.parse(action?.value ?? '{}') as { ruleId?: string }).ruleId ?? '';
    } catch {
      console.error('[RULES] reject_refined_rule: failed to parse value');
      return;
    }

    if (!ruleId) {
      console.error('[RULES] reject_refined_rule: missing ruleId');
      return;
    }

    try {
      const updated = await updateRule(ruleId, { status: 'rejected' });
      if (!updated) {
        console.warn('[RULES] reject_refined_rule: rule not found');
        return;
      }

      invalidateCache();

      const message = (body as { message?: { blocks?: KnownBlock[] } }).message;
      if (message?.blocks && channelId && messageTs) {
        const updatedBlocks = buildRuleActionedRecapBlocks(message.blocks, ruleId, 'rejected', userId);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: '✏️ Refined rule review (updated)',
          });
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          console.warn('[RULES] reject_refined_rule: could not update recap message (non-blocking): ' + msg);
        }
      }

      console.log('[RULES] Refined rule ' + ruleId + ' rejected by ' + userId);
    } catch (error) {
      console.error('[RULES] reject_refined_rule error:', error);
    }
  });
}
