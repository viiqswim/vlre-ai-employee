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
  const proxyUrl = process.env['CLAUDE_PROXY_URL'] ?? 'http://127.0.0.1:3456';
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const model = process.env['CLAUDE_MODEL'] ?? 'claude-3-5-sonnet-20241022';
  const mode = process.env['CLAUDE_MODE'] ?? (apiKey ? 'api' : 'proxy');
  const timeoutMs = parseInt(process.env['CLAUDE_TIMEOUT_MS'] ?? '30000', 10);
  const userMessage = '## Question\n' + question + '\n\n## Knowledge Base Context\n' + kbContext;

  try {
    let responseText: string;

    if (mode === 'proxy') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${proxyUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            max_tokens: 800,
            messages: [
              { role: 'system', content: KB_ASSISTANT_PROMPT },
              { role: 'user', content: userMessage },
            ],
          }),
        });
        if (!response.ok) { console.error('[KB-ASSISTANT] Proxy error: ' + response.status); return { found: false, answer: null, source: null }; }
        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        responseText = data.choices?.[0]?.message?.content ?? '';
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      if (!apiKey) { console.warn('[KB-ASSISTANT] ANTHROPIC_API_KEY not set'); return { found: false, answer: null, source: null }; }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model, max_tokens: 800, system: KB_ASSISTANT_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
        });
        if (!response.ok) { console.error('[KB-ASSISTANT] API error: ' + response.status); return { found: false, answer: null, source: null }; }
        const data = await response.json() as { content: Array<{ type: string; text: string }> };
        responseText = data.content?.find((c) => c.type === 'text')?.text ?? '';
      } finally {
        clearTimeout(timeoutId);
      }
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