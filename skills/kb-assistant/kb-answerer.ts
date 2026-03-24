import type { PropertyMap } from '../kb-reader/multi-reader.js';

export interface KBAnswerResult {
  found: boolean;
  answer: string | null;
  source: string | null;
}

export const KB_ASSISTANT_PROMPT = `You are Papi Chulo, an internal knowledge assistant for VL Real Estate.
A team member is asking a question. Search the provided knowledge base context and answer.

RULES:
- Answer concisely and directly
- ALWAYS cite your source: mention the file name and section heading where you found the answer
- If the KB context does NOT contain the answer, respond with EXACTLY: {"found": false, "answer": null, "source": null}
- If the KB context DOES contain the answer, respond with: {"found": true, "answer": "<your answer>", "source": "<file: section heading>"}
- Do NOT make up answers. Only use information from the provided KB context.
- Use casual, friendly tone`;

export async function askKBAssistant(question: string, kbContext: string): Promise<KBAnswerResult> {
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  if (!openRouterKey) { console.warn('[KB-ASSISTANT] OPENROUTER_API_KEY not set'); return { found: false, answer: null, source: null }; }
  const openRouterBaseUrl = (process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env['OPENROUTER_MODEL'] ?? 'minimax/minimax-m2.7';
  const timeoutMs = parseInt(process.env['OPENROUTER_TIMEOUT_MS'] ?? '30000', 10);
  const userMessage = '## Question\n' + question + '\n\n## Knowledge Base Context\n' + kbContext;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let responseText: string;
    try {
      const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'system', content: KB_ASSISTANT_PROMPT }, { role: 'user', content: userMessage }] }),
      });
      if (!response.ok) { console.error('[KB-ASSISTANT] OpenRouter API error: ' + response.status); return { found: false, answer: null, source: null }; }
      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      responseText = data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeoutId);
    }
    if (!responseText) return { found: false, answer: null, source: null };
    return parseKBAnswer(responseText);
  } catch (error) {
    console.error('[KB-ASSISTANT] askKBAssistant error:', error);
    return { found: false, answer: null, source: null };
  }
}

export function parseKBAnswer(responseText: string): KBAnswerResult {
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ?? responseText.match(/(\{[\s\S]+\})/);
  if (!jsonMatch?.[1]) return { found: false, answer: null, source: null };
  try {
    const parsed = JSON.parse(jsonMatch[1]) as { found?: boolean; answer?: string | null; source?: string | null };
    if (parsed.found === true && parsed.answer) return { found: true, answer: parsed.answer, source: parsed.source ?? null };
    return { found: false, answer: null, source: null };
  } catch { return { found: false, answer: null, source: null }; }
}

export interface FormatKBEntryResult {
  entry: string;
  appliesToAll: boolean;
}

export async function formatKBEntry(question: string, rawAnswer: string): Promise<FormatKBEntryResult> {
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  const openRouterBaseUrl = (process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env['OPENROUTER_MODEL'] ?? 'minimax/minimax-m2.7';
  const timeoutMs = parseInt(process.env['OPENROUTER_TIMEOUT_MS'] ?? '30000', 10);

  const fallback = (): FormatKBEntryResult => {
    const title = rawAnswer.substring(0, 60);
    return { entry: '### ' + title + '\nQ: ' + question + '\nA: ' + rawAnswer, appliesToAll: false };
  };

  const prompt = [
    'A team member was asked this question about a rental property:',
    '"' + question + '"',
    '',
    'They provided this answer:',
    '"' + rawAnswer + '"',
    '',
    'Write a concise, ENGLISH-LANGUAGE knowledge base entry that:',
    '1. Has a descriptive heading (### Topic — Subtopic)',
    '2. Contains the answer clearly',
    '3. Includes relevant English search keywords (and Spanish equivalents if the original question was in Spanish)',
    '4. Is generic enough to match similar future questions about the same topic',
    '5. Is 2-5 lines max, no fluff',
    '6. Determine if the answer is specific to one property or applies to all properties.',
    '',
    'Output ONLY valid JSON in this format (no preamble, no explanation):',
    '{"entry": "<the formatted KB entry>", "appliesToAll": true|false}',
    '',
    'Set appliesToAll to true ONLY if the answer describes a policy, procedure, or fact that applies equally to ALL properties (e.g., check-out time, cancellation policy, general house rules, cleaning fees, booking policies).',
    'Set it to false if the answer mentions specific details about one property (e.g., WiFi password, appliance brand at a specific address, specific amenity location, unit-specific instructions).',
  ].join('\n');

  try {
    if (!openRouterKey) return fallback();
    let responseText: string;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!response.ok) return fallback();
      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      responseText = data.choices?.[0]?.message?.content?.trim() ?? '';
    } finally {
      clearTimeout(timeoutId);
    }
    if (!responseText) return fallback();
    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ?? responseText.match(/(\{[\s\S]+\})/);
      const jsonStr = jsonMatch?.[1] ?? responseText;
      const parsed = JSON.parse(jsonStr) as { entry?: string; appliesToAll?: boolean };
      if (typeof parsed.entry === 'string' && typeof parsed.appliesToAll === 'boolean') {
        return { entry: parsed.entry, appliesToAll: parsed.appliesToAll };
      }
    } catch { }
    return { entry: responseText, appliesToAll: false };
  } catch {
    return fallback();
  }
}

export function detectPropertyInQuestion(question: string, propertyMap: PropertyMap): string | null {
  if (!question || !propertyMap?.properties?.length) return null;
  const questionLower = question.toLowerCase();
  for (const entry of propertyMap.properties) {
    if (entry.names.some((n) => n.toLowerCase() === questionLower)) return entry.names[0] ?? entry.code;
  }
  for (const entry of propertyMap.properties) {
    const matchesName = entry.names.some((n) => n.toLowerCase().includes(questionLower) || questionLower.includes(n.toLowerCase()));
    const matchesCode = entry.code.toLowerCase().includes(questionLower) || questionLower.includes(entry.code.toLowerCase());
    const matchesAddress = entry.address.toLowerCase().includes(questionLower) || questionLower.includes(entry.address.toLowerCase());
    if (matchesName || matchesCode || matchesAddress) return entry.names[0] ?? entry.code;
  }
  return null;
}