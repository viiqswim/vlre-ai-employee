import type { App } from '@slack/bolt';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { MultiPropertyKBReader } from '../kb-reader/multi-reader.ts';
import type { SlackThreadTracker } from '../thread-tracker/thread-tracker.ts';
import type { NotionSearcher } from '../notion-search/notion-search.js';
import type { SifelyClient } from '../sifely-client/sifely-client.ts';
import type { VlreHubClient } from '../vlre-hub-client/vlre-hub-client.ts';
import type { LockDiagnosis } from '../lock-types.ts';
import { buildApprovalBlocks, buildErrorBlocks, buildSupersededBlocks } from '../slack-blocks/blocks.ts';
import { diagnoseLockAccess } from '../lock-diagnosis/index.ts';
import { withRetry } from './retry.js';
import { appendAuditLog } from '../audit-logger/audit-logger.ts';
import { type LearnedRule } from './learned-rules.ts';
import { getConfirmedRules } from './rules-store.js';

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
  notionSearch?: NotionSearcher;
  sifelyClient?: SifelyClient;
  vlreHubClient?: VlreHubClient;
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

export const SYSTEM_PROMPT = `You are ${BOT_NAME}, a professional guest communication specialist for VL Real Estate, a short-term rental company in Austin, Texas.

Your job is to:
1. Read a guest's message carefully
2. Look up relevant information in the knowledge base
3. Generate a friendly, professional draft response
4. Rate your confidence in the response quality (0.0-1.0)
5. Categorize the type of request

TONE & STYLE RULES:
Write like a friendly, knowledgeable property manager texting a guest. Not a corporate bot.

DO:
- Use contractions (you're, it's, we've, don't, can't, we'll)
- Vary sentence length — mix short punchy sentences with longer explanatory ones
- Use dashes for asides (e.g., "The pool's heated — usually takes 30 min to warm up")
- Acknowledge emotions before solving problems ("That's super frustrating" before troubleshooting)
- Answer the actual question directly — don't give generic info
- Use the guest's name when possible
- Reference specific property details from the knowledge base
- Keep it brief — 2-3 sentences for simple questions, 3-4 max for complex ones
- Match the booking channel: Airbnb guests expect casual; Booking.com guests expect slightly more formal (but never corporate)
- Write in plain text only — no markdown, no formatting of any kind
- Use natural paragraph flow — never bullet points, never numbered lists
- Start sentences with different words — don't begin three sentences the same way
- Use casual connectors: "So," "Plus," "Also," "But," "And"
- Include mild conversational filler when it sounds natural: "just," "actually," "honestly"
- Acknowledge the specific situation before answering ("Got it" or "Sorry about that" before solving)

NEVER USE THESE PHRASES:
- "I hope this message finds you well"
- "Please don't hesitate to reach out"
- "I'd be happy to assist" / "happy to help"
- "Thank you for your inquiry" / "Thank you for reaching out"
- "We appreciate your patience"
- "At your earliest convenience"
- "Should you have any questions"
- "Feel free to contact us"
- "We look forward to your stay"
- "It's important to note that"
- "Additionally" / "Furthermore" / "Moreover"
- "Rest assured"
- "I want to assure you"
- "Certainly" / "Absolutely" (as standalone affirmations)
- "Great question!" / "That's a great point"
- "I completely understand" / "I totally understand"
- "No worries at all"
- "Here's what you need to know" / "Here are the details"
- "Let me break this down"
- "For your convenience"
- "delve into" / "dive into"
- "I want to make sure" / "I want to ensure"
- "Moving forward"
- "In order to" / "Prior to"
- "It's worth noting that" / "As a matter of fact"
- "seamless" / "streamline" / "elevate" / "enhance" / "optimize"
- "multifaceted" / "comprehensive" / "holistic"
- "foster" / "cultivate" / "leverage"

NEVER DO:
- Write three sentences of similar length in a row
- Use buzzwords: leverage, seamless, holistic, elevate, enhance, streamline, optimize
- Add unnecessary pleasantries before answering
- Sound like a corporate FAQ page
- Promise things you're not sure about — say "I'll check on that and get back to you"

FORMATTING RULES (CRITICAL — violating these is the #1 edit reason):
- NEVER use markdown: no **bold**, no *italic*, no \`backticks\`, no # headers, no > blockquotes
- NEVER use numbered lists (1. 2. 3.) or bullet points (- or •)
- NEVER use em dashes (—) more than once per message
- Write in natural flowing sentences, not structured lists
- If you need to give multiple pieces of info, weave them into prose:
  BAD: "1. WiFi: GuestNetwork 2. Password: abc123 3. Door code: 4829"
  GOOD: "WiFi is GuestNetwork, password abc123. Door code is 4829."

SIGNATURE RULES:
- NEVER add any signature, sign-off, or closing to your draftResponse
- NEVER end with phrases like: "Best regards", "Warm regards", "Kind regards", "Sincerely", "Best wishes", "Yours truly", "From your management team", "From VL Real Estate", "The VL Real Estate Team", "Your hosts", "Your management team"
- NEVER add any "From [name/team]" line at the end
- Just end the message naturally after your last point — no closing, no name, no sign-off

GOOD RESPONSE EXAMPLES (write like these):
- WiFi question: "WiFi is GuestNetwork, password abc123. Router's in the living room closet if you need to restart it."
- Early check-in request: "Check-in's normally at 3 but let me see if the place is ready earlier. I'll get back to you within the hour."
- AC not working: "Sorry about that. Try the remote on the nightstand — sometimes it just needs fresh batteries. If that doesn't fix it, let me know and I'll send someone over."
- Parking question: "Parking is in the garage on the side of the house. Gate code is 1234."

BAD RESPONSE EXAMPLES (never write like these):
- "Thank you for reaching out! Here's what you need to know about our WiFi:\n\n**Network:** GuestNetwork\n**Password:** abc123\n\nPlease don't hesitate to reach out if you need anything else!"
- "I'd be happy to help with your early check-in request! I want to make sure we can accommodate your needs. I'll look into this for you and get back to you at your earliest convenience."
- "Here are the key details for your parking:\n\n1. Location: Garage on the side\n2. Gate code: 1234\n3. Hours: Available 24/7\n\nFeel free to contact us should you have any questions!"

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
- <0.5: Low confidence — escalation triggers, complex situation, or no KB match

## Door Access & Lock Issues

When a guest reports they cannot open the door, cannot get in, or has access code problems:
- Classify as category: "access"
- Set urgency: true if the guest is currently locked out or unable to enter
- In your draft response, acknowledge their situation and let them know we're checking their access code
- If lock diagnosis data is provided in the context, use it to craft your response:
  - If codes match and access records show successful entries: suggest the guest try again, ensure they're entering the correct code
  - If codes match but no recent access attempts: provide the door code and walk them through using it
  - If codes DON'T match: acknowledge the issue and explain that the team is fixing it
  - If access records show failed attempts with wrong code: the guest is entering an incorrect code, provide the correct one
- ALWAYS include the door code in your response when it's an access-related question
- NEVER suggest the guest contact us separately — you ARE the contact channel`;

// Load confirmed learned rules at startup (hot-reload via getConfirmedRules)
console.log(`[PIPELINE] Loaded ${getConfirmedRules().length} learned rule(s) from CS team feedback`);

/** Build a prompt section from confirmed learned rules. Returns '' if no rules. */
export function buildLearnedRulesPrompt(rules: LearnedRule[], propertyName?: string): string {
  // Filter by scope: include global rules + property-specific rules matching this property
  const filtered = rules.filter((r) => {
    const scope = r.scope ?? 'global';
    return scope === 'global' || scope === propertyName;
  });
  if (filtered.length === 0) return '';
  const ruleLines = filtered.map((r, i) => {
    const scope = r.scope ?? 'global';
    const label = scope === 'global'
      ? `(observed in ${r.frequency} CS team edits)`
      : `(for ${scope})`;
    return `${i + 1}. ${r.correction} ${label}`;
  });
  return `\n\nLEARNED RULES FROM CS TEAM FEEDBACK:\nThe following rules were learned from how the CS team edits your responses. Follow these strictly:\n${ruleLines.join('\n')}`;
}

/**
 * Builds a human-readable conversation summary from raw thread history when
 * Claude does not return a conversationSummary. Filters SYSTEM messages,
 * humanizes sender labels, and caps output at 400 chars.
 */
export function buildFallbackSummary(conversationHistory: string): string {
  if (!conversationHistory.trim()) return '';

  const lines = conversationHistory.split('\n').filter(line => line.trim());
  const filtered = lines.filter(line => !line.startsWith('[SYSTEM]'));

  if (filtered.length === 0) return '';

  const humanized = filtered.map(line =>
    line
      .replace(/^\[GUEST\]:\s*/i, 'Guest: ')
      .replace(/^\[TRAVELER\]:\s*/i, 'Guest: ')
      .replace(/^\[PROPERTY_MANAGER\]:\s*/i, 'Host: ')
      .replace(/^\[AGENCY\]:\s*/i, 'Host: ')
      .replace(/^\[Unknown\]:\s*/i, ''),
  );

  const joined = humanized.join('\n');
  return joined.length > 400 ? joined.substring(0, 397) + '…' : joined;
}

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

export function parseClassifyResponse(responseText: string): ClassifyResult {
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
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  if (!openRouterKey) throw new Error('[PIPELINE] OPENROUTER_API_KEY not set');
  const openRouterBaseUrl = (process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env['OPENROUTER_MODEL'] ?? 'minimax/minimax-m2.7';
  const retryAttempts = parseInt(process.env['OPENROUTER_RETRY_ATTEMPTS'] ?? '2', 10);
  const timeoutMs = parseInt(process.env['OPENROUTER_TIMEOUT_MS'] ?? '30000', 10);

  const userMessage = buildUserMessage(params);
  const fullPrompt = SYSTEM_PROMPT + buildLearnedRulesPrompt(getConfirmedRules(), params.propertyName);

  console.log(`[PIPELINE] Calling OpenRouter (model: ${model})`);

  let response: Response;
  try {
    response = await withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(`${openRouterBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            messages: [
              { role: 'system', content: fullPrompt },
              { role: 'user', content: userMessage },
            ],
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }, { maxAttempts: retryAttempts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`[PIPELINE] OpenRouter API connection failed: ${msg}`);
  }

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('[PIPELINE] OpenRouter returned empty response');

  return parseClassifyResponse(content);
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
  } catch (error) {
    console.warn(`[PIPELINE] Could not fetch thread history: ${error}`);
  }

  const leadUid = lead_uid ?? threadLeadUid ?? '';
  if (leadUid) {
    try {
      const allMessages = await hostfullyClient.getMessages(leadUid);
      const threadMessages = allMessages
        .filter((m) => (!m.threadUid || m.threadUid === thread_uid) && m.uid !== message_uid)
        .sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0))
        .slice(-30);
      conversationHistory = threadMessages
        .map((m) => `[${m.senderType || 'Unknown'}]: ${m.content}`)
        .join('\n');
      console.log(`[PIPELINE] Fetched ${allMessages.length} messages for lead ${leadUid}, ${threadMessages.length} in thread ${thread_uid}`);
    } catch (error) {
      console.warn(`[PIPELINE] Could not fetch message history: ${error}`);
    }
  }
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

  let doorCode: string | null = null;
  if (propUid) {
    try {
      doorCode = await hostfullyClient.getDoorCode(propUid);
    } catch (e) {
      console.warn('[PIPELINE] getDoorCode failed for property:', propUid, e);
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

  let notionContext = '';
  if (context.notionSearch) {
    try {
      const notionResults = await context.notionSearch.search(messageContent);
      notionContext = context.notionSearch.formatAsContext(notionResults);
    } catch (error) {
      console.warn(`[PIPELINE] Notion search failed, continuing with KB only: ${(error as Error).message}`);
    }
  }
  const fullKBContext = notionContext
    ? kbContext + '\n\n---\n\n## Additional Context (Company Wiki)\n' + notionContext
    : kbContext;

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
      knowledgeBase: fullKBContext,
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

  let lockDiagnosis: LockDiagnosis | null = null;
  if (classifyResult.category === 'access' && context.sifelyClient && context.vlreHubClient && propUid) {
    try {
      lockDiagnosis = await diagnoseLockAccess({
        propertyUid: propUid,
        hostfullyClient,
        sifelyClient: context.sifelyClient,
        vlreHubClient: context.vlreHubClient,
      });
    } catch (e) {
      console.warn('[PIPELINE] Lock diagnosis failed for property:', propUid, e);
    }
  }

  const resolvedConversationSummary =
    classifyResult.conversationSummary ||
    (conversationHistory.trim() ? buildFallbackSummary(conversationHistory) : null);

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
      conversationSummary: resolvedConversationSummary,
      messageUid: message_uid,
      threadUid: thread_uid,
      leadUid,
      urgency: classifyResult.urgency,
      doorCode,
      lockDiagnosis,
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
