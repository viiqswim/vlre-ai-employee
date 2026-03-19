import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { LearnedRule } from '../pipeline/learned-rules.js';
import {
  updateRule,
  addRule,
  getConfirmedRules,
  invalidateCache,
} from '../pipeline/rules-store.js';
import {
  buildRuleActionedRecapBlocks,
  buildAddRuleModal,
  buildRemoveRuleModal,
} from '../slack-blocks/recap-blocks.js';

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
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks,
          text: '📊 Weekly Rules Recap (updated)',
        });
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
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks,
          text: '📊 Weekly Rules Recap (updated)',
        });
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
}
