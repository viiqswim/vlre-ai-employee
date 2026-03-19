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
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const model = process.env['CLAUDE_MODEL'] ?? 'claude-3-5-sonnet-20241022';
  const userMessage = '## Question\n' + question + '\n\n## Knowledge Base Context\n' + kbContext;
  try {
    if (!apiKey) { console.warn('[KB-ASSISTANT] ANTHROPIC_API_KEY not set'); return { found: false, answer: null, source: null }; }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 800, system: KB_ASSISTANT_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
    });
    if (!response.ok) { console.error('[KB-ASSISTANT] API error: ' + response.status); return { found: false, answer: null, source: null }; }
    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const textContent = data.content?.find((c) => c.type === 'text');
    if (!textContent?.text) return { found: false, answer: null, source: null };
    return parseKBAnswer(textContent.text);
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