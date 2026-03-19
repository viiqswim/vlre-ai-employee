import { appendFileSync, mkdirSync, existsSync } from 'fs';
import type { App } from '@slack/bolt';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import {
  buildApprovedBlocks,
  buildRejectedBlocks,
  buildEditedBlocks,
  buildErrorBlocks,
  buildEditModal,
  type PostActionContext,
} from '../slack-blocks/blocks.ts';

interface ButtonMetadata {
  messageUid: string;
  threadUid: string;
  leadUid: string;
  guestName: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  draftResponse: string;
}

interface ModalMetadata {
  channelId: string;
  messageTs: string;
  threadUid: string;
  leadUid: string;
  messageUid: string;
  draftResponse: string;
  guestName: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
}

function parseMetadata(value: string): ButtonMetadata {
  try {
    return JSON.parse(value) as ButtonMetadata;
  } catch {
    throw new Error(`Failed to parse button metadata: ${value.substring(0, 100)}`);
  }
}

export function appendAuditLog(entry: object, logFile: string = 'logs/actions.jsonl'): void {
  try {
    const lastSlash = logFile.lastIndexOf('/');
    const dir = lastSlash > 0 ? logFile.substring(0, lastSlash) : '';
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    appendFileSync(logFile, line, 'utf-8');
  } catch (error) {
    console.error('[SLACK] Failed to write audit log:', error);
  }
}

export function registerApproveHandler(
  app: App,
  hostfullyClient: HostfullyClient,
  threadTracker: SlackThreadTracker,
): void {
  app.action('approve_response', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    if (!action?.value) {
      console.error('[SLACK] Approve: missing action value');
      return;
    }

    let metadata: ButtonMetadata;
    try {
      metadata = parseMetadata(action.value);
    } catch (e) {
      console.error('[SLACK] Approve: failed to parse metadata:', e);
      return;
    }

    console.log(`[SLACK] Approve clicked by ${userId} for message ${metadata.messageUid}`);

    try {
      await hostfullyClient.sendMessage(metadata.threadUid, metadata.draftResponse);
      console.log(`[SLACK] Approve: sent message to thread ${metadata.threadUid}`);
      threadTracker.clear(metadata.threadUid);

      const context: PostActionContext = {
        guestName: metadata.guestName ?? '',
        propertyName: metadata.propertyName ?? '',
        checkInDate: metadata.checkInDate ?? '',
        checkOutDate: metadata.checkOutDate ?? '',
        threadUid: metadata.threadUid,
        leadUid: metadata.leadUid,
      };

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        blocks: buildApprovedBlocks(userId, metadata.draftResponse, context),
        text: `✅ Approved and sent by <@${userId}>`,
      });

      appendAuditLog({
        action: 'approve',
        userId,
        messageUid: metadata.messageUid,
        threadUid: metadata.threadUid,
        hostfullySendSuccess: true,
        approvedDraft: metadata.draftResponse,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SLACK] Approve: send failed: ${errorMsg}`);

      appendAuditLog({
        action: 'approve',
        userId,
        messageUid: metadata.messageUid,
        threadUid: metadata.threadUid,
        hostfullySendSuccess: false,
        error: errorMsg,
      });

      try {
        const errorContext: PostActionContext = {
          guestName: metadata.guestName ?? '',
          propertyName: metadata.propertyName ?? '',
          checkInDate: metadata.checkInDate ?? '',
          checkOutDate: metadata.checkOutDate ?? '',
          threadUid: metadata.threadUid,
          leadUid: metadata.leadUid,
        };
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: buildErrorBlocks(errorMsg, errorContext),
          text: `🚨 Send failed: ${errorMsg}`,
        });
      } catch (updateError) {
        console.error('[SLACK] Approve: failed to update message with error state:', updateError);
      }
    }
  });
}

export function registerRejectHandler(app: App, threadTracker: SlackThreadTracker): void {
  app.action('reject_response', async ({ ack, body, client }) => {
    await ack();

    const userId = body.user.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    console.log(`[SLACK] Reject clicked by ${userId}`);

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    let messageUid = 'unknown';
    let threadUid = 'unknown';
    let meta: Partial<ButtonMetadata> = {};
    if (action?.value) {
      try {
        meta = JSON.parse(action.value) as Partial<ButtonMetadata>;
        if (meta.threadUid) {
          threadUid = meta.threadUid;
          threadTracker.clear(meta.threadUid);
        }
        if (meta.messageUid) messageUid = meta.messageUid;
      } catch { }
    }

    try {
      const context: PostActionContext = {
        guestName: meta.guestName ?? '',
        propertyName: meta.propertyName ?? '',
        checkInDate: meta.checkInDate ?? '',
        checkOutDate: meta.checkOutDate ?? '',
        threadUid: threadUid,
        leadUid: meta.leadUid ?? '',
      };

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        blocks: buildRejectedBlocks(userId, context),
        text: `❌ Rejected by <@${userId}>`,
      });

      appendAuditLog({ action: 'reject', userId, messageUid, threadUid });
    } catch (error) {
      console.error('[SLACK] Reject: failed to update message:', error);
    }
  });
}

export function registerEditHandler(
  app: App,
  hostfullyClient: HostfullyClient,
  threadTracker: SlackThreadTracker,
): void {
  app.action('edit_response', async ({ ack, body, client }) => {
    await ack();

    const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
    const triggerId = (body as { trigger_id?: string }).trigger_id ?? '';
    const channelId = (body as { channel?: { id?: string } }).channel?.id ?? '';
    const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? '';

    if (!action?.value) {
      console.error('[SLACK] Edit: missing action value');
      return;
    }

    let metadata: ButtonMetadata;
    try {
      metadata = parseMetadata(action.value);
    } catch (e) {
      console.error('[SLACK] Edit: failed to parse metadata:', e);
      return;
    }

    console.log(`[SLACK] Edit clicked by ${body.user.id} for message ${metadata.messageUid}`);

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildEditModal({
          draftResponse: metadata.draftResponse,
          channelId,
          messageTs,
          threadUid: metadata.threadUid,
          leadUid: metadata.leadUid,
          messageUid: metadata.messageUid,
          guestName: metadata.guestName ?? '',
          propertyName: metadata.propertyName ?? '',
          checkInDate: metadata.checkInDate ?? '',
          checkOutDate: metadata.checkOutDate ?? '',
        }) as Parameters<typeof client.views.open>[0]['view'],
      });
    } catch (error) {
      console.error('[SLACK] Edit: failed to open modal:', error);
    }
  });

  app.view('edit_response_modal', async ({ ack, body, client, view }) => {
    await ack();

    const userId = body.user.id;
    const editedText =
      view.state.values['edited_response_block']?.['edited_response_input']?.value ?? '';

    let modalMetadata: ModalMetadata;
    try {
      modalMetadata = JSON.parse(view.private_metadata) as ModalMetadata;
    } catch {
      console.error('[SLACK] Edit modal: failed to parse private_metadata');
      return;
    }

    console.log(`[SLACK] Edit modal submitted by ${userId}, sending to thread ${modalMetadata.threadUid}`);

    try {
      await hostfullyClient.sendMessage(modalMetadata.threadUid, editedText);
      console.log('[SLACK] Edit: sent edited message');
      threadTracker.clear(modalMetadata.threadUid);

      const context: PostActionContext = {
        guestName: modalMetadata.guestName ?? '',
        propertyName: modalMetadata.propertyName ?? '',
        checkInDate: modalMetadata.checkInDate ?? '',
        checkOutDate: modalMetadata.checkOutDate ?? '',
        threadUid: modalMetadata.threadUid,
        leadUid: modalMetadata.leadUid,
      };

      await client.chat.update({
        channel: modalMetadata.channelId,
        ts: modalMetadata.messageTs,
        blocks: buildEditedBlocks(userId, editedText, context),
        text: `✏️ Edited and sent by <@${userId}>`,
      });

      appendAuditLog({
        action: 'edit',
        userId,
        messageUid: modalMetadata.messageUid,
        threadUid: modalMetadata.threadUid,
        hostfullySendSuccess: true,
        originalDraft: modalMetadata.draftResponse ?? '',
        editedText,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SLACK] Edit: send failed: ${errorMsg}`);

      appendAuditLog({
        action: 'edit',
        userId,
        messageUid: modalMetadata.messageUid,
        threadUid: modalMetadata.threadUid,
        hostfullySendSuccess: false,
        error: errorMsg,
      });

      try {
        const errorContext: PostActionContext = {
          guestName: modalMetadata.guestName ?? '',
          propertyName: modalMetadata.propertyName ?? '',
          checkInDate: modalMetadata.checkInDate ?? '',
          checkOutDate: modalMetadata.checkOutDate ?? '',
          threadUid: modalMetadata.threadUid,
          leadUid: modalMetadata.leadUid,
        };
        await client.chat.update({
          channel: modalMetadata.channelId,
          ts: modalMetadata.messageTs,
          blocks: buildErrorBlocks(errorMsg, errorContext),
          text: `🚨 Send failed: ${errorMsg}`,
        });
      } catch (updateError) {
        console.error('[SLACK] Edit: failed to update message with error state:', updateError);
      }
    }
  });
}

export function registerAllHandlers(
  app: App,
  hostfullyClient: HostfullyClient,
  threadTracker: SlackThreadTracker,
): void {
  registerApproveHandler(app, hostfullyClient, threadTracker);
  registerRejectHandler(app, threadTracker);
  registerEditHandler(app, hostfullyClient, threadTracker);
  console.log('[SLACK] All action handlers registered (approve, reject, edit)');
}
