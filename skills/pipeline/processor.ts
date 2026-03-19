import type { App } from '@slack/bolt';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { MultiPropertyKBReader } from '../kb-reader/multi-reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import { buildApprovalBlocks, buildErrorBlocks, buildSupersededBlocks } from '../slack-blocks/blocks.ts';
import { withRetry } from './retry.js';
import { appendAuditLog } from '../audit-logger/audit-logger.ts';

export interface WebhookPayload {
  event_type: string;
  message_uid: string;
  thread_uid: string;
  lead_uid?: string;
  agency_uid: string;
  property_uid?: string;
  message_content?: string;
}

export interface PipelineContext {
  hostfullyClient: HostfullyClient;
  kbReader: MultiPropertyKBReader;
  slackApp: App;
  slackChannelId: string;
  threadTracker: SlackThreadTracker;
}

interface ClassifyParams {
  guestMessage: string;
  conversationHistory: string;
  guestName: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  channel: string;
  knowledgeBase: string;
}

interface ClassifyResult {
  classification: 'NEEDS_APPROVAL';
  confidence: number;
  reasoning: string;
  draftResponse: string;
  summary: string;
  category: string;
  conversationSummary: string | null;
  urgency: boolean;
}

const BOT_NAME = process.env['BOT_NAME'] ?? 'Papi Chulo';

const SYSTEM_PROMPT = `You are ${BOT_NAME}, a professional guest communication specialist for VL Real Estate, a short-term rental company in Austin, Texas.

Your job is to:
1. Read a guest's message carefully
2. Look up relevant information in the knowledge base
3. Generate a friendly, professional draft response
4. Rate your confidence in the response quality (0.0-1.0)
5. Categorize the type of request

IMPORTANT RULES:
- Always maintain a warm, professional tone
- Use the guest's name when possible
- Reference specific property info when available in the KB
- For maintenance/urgent issues: draft an acknowledgment but flag as high-confidence needing approval
- Never promise things you're not sure about
- Keep responses concise but complete (2-4 sentences typically)
- Match the communication channel style (Airbnb: casual, Booking.com: formal)

SIGNATURE RULES:
- NEVER add any signature, sign-off, or closing to your draftResponse
- NEVER end with phrases like: "Best regards", "Warm regards", "Kind regards", "Sincerely", "Best wishes", "Yours truly", "From your management team", "From VL Real Estate", "The VL Real Estate Team", "Your hosts", "Your management team"
- NEVER add any "From [name/team]" line at the end
- Just end the message naturally after your last point — no closing, no name, no sign-off

You MUST respond with valid JSON in this exact format:
{
  "classification": "NEEDS_APPROVAL",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<why you classified it this way>",
  "draftResponse": "<the response to send to the guest>",
  "summary": "<one-line summary for the CS team, e.g.: 'WiFi password request — Lakewood Retreat'>",
  "category": "<one of: wifi, access, early-checkin, late-checkout, parking, amenities, maintenance, noise, pets, refund, other>",
  "conversationSummary": "<if there is prior conversation history, write 2-3 sentences summarising the full thread so far. If this is the first message in the thread, set this to null>",
  "urgency": true or false — set to true ONLY for: guest locked out, can't access property, gas/CO smell, flooding, fire, broken windows/doors/locks, mold/pests, police involvement, medical emergency, immediate safety threats. Set to false for all routine questions (WiFi, check-in times, amenities, parking).
}

Confidence guidelines:
- 0.9+: KB has exact answer, straightforward request, response is clearly correct
- 0.7-0.9: Good KB match, minor judgment involved
- 0.5-0.7: Moderate confidence, CS team may want to adjust
- <0.5: Low confidence — escalation triggers, complex situation, or no KB match`;

function buildUserMessage(params: ClassifyParams): string {
  return `## Guest Information
- Guest Name: ${params.guestName}
- Property: ${params.propertyName}
- Check-in: ${params.checkInDate}
- Check-out: ${params.checkOutDate}
- Booking Channel: ${params.channel}

## Guest's Message
${params.guestMessage}

${params.conversationHistory ? `## Previous Conversation\n${params.conversationHistory}\n\n` : ''}## Knowledge Base
${params.knowledgeBase}

Please classify this message and draft a response following the JSON format in your instructions.`;
}

function parseClassifyResponse(responseText: string): ClassifyResult {
  const jsonMatch =
    responseText.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
    responseText.match(/(\{[\s\S]+\})/);

   const jsonString = jsonMatch?.[1] ?? responseText;

   let parsed: Partial<ClassifyResult>;
   try {
     parsed = JSON.parse(jsonString) as Partial<ClassifyResult>;
   } catch {
     console.error('[PIPELINE] Failed to parse Claude JSON response — using fallback');
     return {
       classification: 'NEEDS_APPROVAL',
       confidence: 0.3,
       reasoning: 'Failed to parse Claude response — manual review required',
       draftResponse: 'Thank you for your message! A member of our team will get back to you shortly.',
       summary: 'Classification failed — manual review needed',
       category: 'other',
       conversationSummary: null,
       urgency: false,
     };
   }

  return {
    classification: 'NEEDS_APPROVAL',
    confidence: Math.min(1.0, Math.max(0.0, parsed.confidence ?? 0.5)),
    reasoning: parsed.reasoning ?? 'No reasoning provided',
    draftResponse: parsed.draftResponse ?? 'Thank you for your message. Our team will be in touch shortly.',
    summary: parsed.summary ?? 'Guest message requires review',
    category: parsed.category ?? 'other',
    conversationSummary: parsed.conversationSummary ?? null,
    urgency: parsed.urgency === true,
  };
}

export async function callClaude(params: ClassifyParams): Promise<ClassifyResult> {
  const proxyUrl = process.env['CLAUDE_PROXY_URL'] ?? 'http://127.0.0.1:3456';
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const model = process.env['CLAUDE_MODEL'] ?? 'claude-3-5-sonnet-20241022';
  const mode = process.env['CLAUDE_MODE'] ?? (apiKey ? 'api' : 'proxy');
  const retryAttempts = parseInt(process.env['CLAUDE_RETRY_ATTEMPTS'] ?? '2', 10);
  const timeoutMs = parseInt(process.env['CLAUDE_TIMEOUT_MS'] ?? '30000', 10);

  const userMessage = buildUserMessage(params);

  let responseText = '';
  let useApiMode = mode !== 'proxy';

  if (mode === 'proxy') {
    console.log(`[PIPELINE] Calling Claude via proxy: ${proxyUrl}`);
    try {
      const response = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(`${proxyUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              max_tokens: 1500,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
              ],
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxAttempts: retryAttempts });

      if (!response.ok) {
        throw new Error(`Claude proxy error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('[PIPELINE] Claude proxy returned empty response');
      responseText = content;
    } catch (error) {
      const fallbackToApi = process.env['CLAUDE_FALLBACK_TO_API'] === 'true';
      if (fallbackToApi && apiKey) {
        useApiMode = true;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`[PIPELINE] Claude proxy connection failed (${proxyUrl}): ${msg}. Is the proxy running?`);
      }
    }
  }

  if (useApiMode) {
    if (!apiKey) throw new Error('[PIPELINE] ANTHROPIC_API_KEY not set');
    console.log(`[PIPELINE] Calling Claude via Anthropic API (model: ${model})`);

    let response: Response;
    try {
      response = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              max_tokens: 1500,
              system: SYSTEM_PROMPT,
              messages: [{ role: 'user', content: userMessage }],
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxAttempts: retryAttempts });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`[PIPELINE] Anthropic API connection failed: ${msg}`);
    }

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const textContent = data.content?.find((c) => c.type === 'text');
    if (!textContent?.text) throw new Error('[PIPELINE] Anthropic API returned empty response');
    responseText = textContent.text;
  }

  return parseClassifyResponse(responseText);
}

export async function processWebhookMessage(
  payload: WebhookPayload,
  context: PipelineContext,
): Promise<void> {
  const { hostfullyClient, kbReader, slackApp, slackChannelId, threadTracker } = context;
  const { message_uid, thread_uid, lead_uid, property_uid } = payload;

  console.log(`[PIPELINE] Processing message ${message_uid}`);

  if (payload.event_type !== 'NEW_INBOX_MESSAGE') {
    console.log(`[PIPELINE] Ignoring event_type: ${payload.event_type}`);
    return;
  }

  if (!message_uid || !thread_uid) {
    console.error('[PIPELINE] Invalid payload: missing message_uid or thread_uid');
    return;
  }

  let messageContent: string;
  let senderType: string | undefined;
  try {
    const message = await hostfullyClient.getMessage(message_uid);
    messageContent = message.content ?? payload.message_content ?? '';
    senderType = message.senderType;
    console.log(`[PIPELINE] Fetched message, sender: ${senderType}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PIPELINE] Failed to fetch message ${message_uid}: ${msg}`);
    await postErrorToSlack(slackApp, slackChannelId, `Failed to fetch message: ${msg}`, message_uid);
    return;
  }

  if (senderType && senderType !== 'GUEST' && senderType !== 'TRAVELER') {
    console.log(`[PIPELINE] Skipping non-guest message (senderType: ${senderType})`);
    return;
  }

  if (!messageContent.trim()) {
    console.log('[PIPELINE] Skipping empty message');
    return;
  }

  let conversationHistory = '';
  let threadLeadUid: string | undefined;
  try {
    const thread = await hostfullyClient.getThread(thread_uid);
    threadLeadUid = thread.participants?.find((p) => p.participantType === 'LEAD')?.participantUid;
    if (thread.messages && thread.messages.length > 1) {
      conversationHistory = thread.messages
        .slice(-5)
        .map((m) => `[${m.senderType ?? 'Unknown'}]: ${m.content}`)
        .join('\n');
    }
  } catch (error) {
    console.warn(`[PIPELINE] Could not fetch thread history: ${error}`);
  }

  const leadUid = lead_uid ?? threadLeadUid ?? '';
  let lead = null as Awaited<ReturnType<HostfullyClient['getLead']>> | null;
  if (leadUid) {
    try {
      lead = await hostfullyClient.getLead(leadUid);
      console.log(`[PIPELINE] Lead: ${lead.guestFirstName} ${lead.guestLastName}, ${lead.checkInDate} – ${lead.checkOutDate}`);
    } catch (error) {
      console.warn(`[PIPELINE] Could not fetch lead: ${error}`);
    }
  }

  let propertyName = 'Unknown Property';
  const propUid = property_uid ?? lead?.propertyUid ?? '';
  if (propUid) {
    try {
      const property = await hostfullyClient.getProperty(propUid);
      propertyName = property.name ?? propertyName;
    } catch (error) {
      console.warn(`[PIPELINE] Could not fetch property: ${error}`);
    }
  }

  const guestName =
    lead ? `${lead.guestFirstName ?? ''} ${lead.guestLastName ?? ''}`.trim() || 'Guest' : 'Guest';
  const checkInDate = lead?.checkInDate ?? 'Unknown';
  const checkOutDate = lead?.checkOutDate ?? 'Unknown';
  const nightCount = lead?.numberOfNights ?? 0;
  const channel = lead?.channel ?? 'DIRECT';

  let kbContext = '';
  try {
    kbContext = kbReader.search(messageContent, propertyName);
  } catch (error) {
    console.warn(`[PIPELINE] KB search failed: ${error}`);
    kbContext = 'Knowledge base unavailable.';
  }

  let classifyResult: ClassifyResult;
  try {
    classifyResult = await callClaude({
      guestMessage: messageContent,
      conversationHistory,
      guestName,
      propertyName,
      checkInDate,
      checkOutDate,
      channel,
      knowledgeBase: kbContext,
    });
    console.log(`[PIPELINE] Classified: ${classifyResult.classification} (${Math.round(classifyResult.confidence * 100)}%)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PIPELINE] Classification failed: ${msg}`);
    await postManualReviewToSlack(slackApp, slackChannelId, {
      guestName,
      propertyName,
      messageContent,
      messageUid: message_uid,
      threadUid: thread_uid,
      leadUid,
      error: msg,
    });
    return;
  }

  try {
    const blocks = buildApprovalBlocks({
      guestName,
      propertyName,
      checkInDate,
      checkOutDate,
      nightCount,
      channel,
      guestMessage: messageContent,
      draftResponse: classifyResult.draftResponse,
      confidence: classifyResult.confidence,
      classification: classifyResult.classification,
      summary: classifyResult.summary,
      conversationSummary: classifyResult.conversationSummary,
      messageUid: message_uid,
      threadUid: thread_uid,
      leadUid,
      urgency: classifyResult.urgency,
    });

    const pending = threadTracker.getPending(thread_uid);

    if (pending) {
      try {
        await slackApp.client.chat.update({
          channel: pending.channelId,
          ts: pending.slackTs,
          blocks: buildSupersededBlocks(),
          text: '⏭️ Superseded — a newer message from this guest is pending review below.',
        });
        await appendAuditLog({
          action: 'supersede',
          threadUid: thread_uid,
          oldSlackTs: pending.slackTs,
          oldMessageUid: pending.messageUid ?? null,
          newMessageUid: message_uid,
        });
        console.log(`[PIPELINE] Superseded previous approval block for thread ${thread_uid}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[PIPELINE] Failed to supersede previous approval block (non-blocking): ${msg}`);
      }
    }

    const postResult = await slackApp.client.chat.postMessage({
      channel: slackChannelId,
      blocks,
      text: classifyResult.urgency
        ? `🚨 URGENT: ${guestName} at ${propertyName}: ${classifyResult.summary}`
        : `New guest message from ${guestName} at ${propertyName}: ${classifyResult.summary}`,
      ...(classifyResult.urgency ? { attachments: [{ color: '#E74C3C', blocks: [] as never[] }] } : {}),
      ...(pending ? { thread_ts: pending.slackTs } : {}),
    });

    if (postResult.ts) {
      threadTracker.track(thread_uid, postResult.ts, slackChannelId, message_uid);
    }

    console.log(`[PIPELINE] ✅ Posted ${classifyResult.urgency ? '🚨 URGENT ' : ''}approval message to Slack for ${guestName} at ${propertyName}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PIPELINE] Failed to post to Slack: ${msg}`);
  }
}

async function postErrorToSlack(
  app: App,
  channelId: string,
  errorMessage: string,
  messageUid: string,
): Promise<void> {
  try {
    await app.client.chat.postMessage({
      channel: channelId,
      blocks: buildErrorBlocks(`${errorMessage} (message: ${messageUid})`),
      text: `🚨 ${BOT_NAME} error: ${errorMessage}`,
    });
  } catch (e) {
    console.error('[PIPELINE] Failed to post error to Slack:', e);
  }
}

async function postManualReviewToSlack(
  app: App,
  channelId: string,
  params: {
    guestName: string;
    propertyName: string;
    messageContent: string;
    messageUid: string;
    threadUid: string;
    leadUid: string;
    error: string;
  },
): Promise<void> {
  try {
    await app.client.chat.postMessage({
      channel: channelId,
      text: `⚠️ *Manual Review Required*\n*Guest:* ${params.guestName} at ${params.propertyName}\n*Message:* ${params.messageContent}\n*Reason:* Classification failed — ${params.error}\n*Thread UID:* ${params.threadUid}`,
    });
  } catch (e) {
    console.error('[PIPELINE] Failed to post manual review to Slack:', e);
  }
}
