import type { LearnedRule } from './learned-rules.js';
import {
  addRule,
  updateRule,
  invalidateCache,
  loadRules,
} from './rules-store.js';
import { DIFF_ANALYZER_PROMPT } from './diff-analyzer-prompt.js';

export interface AnalysisResult {
  ruleCreated: boolean;
  rule?: LearnedRule;
  skipped: boolean;
  error?: string;
}

interface DiffAnalysisResponse {
  pattern: string;
  correction: string;
  scope: string;
  skip: boolean;
  skipReason?: string | null;
}

/**
 * Analyzes an edit diff using Claude to detect generalizable patterns.
 * Auto-confirms rules immediately. Never throws — all errors are caught and logged.
 * Designed to be called fire-and-forget from the Slack edit handler.
 */
export async function analyzeEditInBackground(params: {
  originalDraft: string;
  editedText: string;
  propertyName: string;
  onRuleCreated?: (rule: LearnedRule) => Promise<void>;
}): Promise<AnalysisResult> {
  const { originalDraft, editedText, propertyName, onRuleCreated } = params;

  try {
    // Skip trivial edits: normalize whitespace/case and compare; also skip if <10% length change
    const stripped = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    if (stripped(originalDraft) === stripped(editedText)) {
      console.log('[ANALYZER] Skipping trivial edit (only whitespace/case changes)');
      return { ruleCreated: false, skipped: true };
    }

    const originalLen = Math.max(originalDraft.length, 1);
    const deltaRatio = Math.abs(originalDraft.length - editedText.length) / originalLen;
    if (deltaRatio < 0.10) {
      console.log(`[ANALYZER] Skipping trivial edit (deltaRatio=${deltaRatio.toFixed(3)} < 0.10)`);
      return { ruleCreated: false, skipped: true };
    }

    if (!originalDraft.trim() || !editedText.trim()) {
      console.log('[ANALYZER] Skipping: empty originalDraft or editedText');
      return { ruleCreated: false, skipped: true };
    }

    // Call Claude to analyze the diff
    const userMessage = `ORIGINAL:\n${originalDraft}\n\nEDITED:\n${editedText}\n\nPROPERTY: ${propertyName}`;
    const analysisJson = await callDiffAnalyzer(userMessage);
    
    if (!analysisJson) {
      return { ruleCreated: false, skipped: false, error: 'Claude returned empty response' };
    }

    let analysis: DiffAnalysisResponse;
    try {
      analysis = JSON.parse(analysisJson) as DiffAnalysisResponse;
    } catch {
      console.error('[ANALYZER] Failed to parse Claude response as JSON:', analysisJson.substring(0, 200));
      return { ruleCreated: false, skipped: false, error: 'Failed to parse analysis JSON' };
    }

    if (analysis.skip) {
      console.log(`[ANALYZER] Claude said skip: ${analysis.skipReason ?? 'no reason given'}`);
      return { ruleCreated: false, skipped: true };
    }

    if (!analysis.pattern || !analysis.correction) {
      console.log('[ANALYZER] Empty pattern or correction — skipping');
      return { ruleCreated: false, skipped: true };
    }

    const scope = analysis.scope === propertyName ? propertyName : 'global';

    const newRule: LearnedRule = {
      id: `rule-${Date.now()}-realtime`,
      pattern: analysis.pattern,
      correction: analysis.correction,
      examples: [
        {
          original: originalDraft.substring(0, 120),
          edited: editedText.substring(0, 120),
        },
      ],
      frequency: 1,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      scope,
    };

    try {
      await addRule(newRule);
      invalidateCache();
      console.log(`[ANALYZER] Auto-confirmed new rule: "${newRule.pattern}" (scope: ${scope})`);

      if (onRuleCreated) {
        await onRuleCreated(newRule);
      }

      return { ruleCreated: true, rule: newRule, skipped: false };
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_PATTERN') {
        // Find existing rule and increment frequency
        const rules = loadRules();
        const existing = rules.find((r) => r.pattern === analysis.pattern);
        if (existing) {
          const updated = await updateRule(existing.id, { frequency: (existing.frequency ?? 1) + 1 });
          invalidateCache();
          console.log(`[ANALYZER] Incremented frequency for existing rule: "${existing.pattern}" → frequency ${(existing.frequency ?? 1) + 1}`);
          return { ruleCreated: false, rule: updated ?? existing, skipped: false };
        }
      }
      throw err; // re-throw non-duplicate errors to outer catch
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ANALYZER] Analysis failed: ${errorMsg}`);
    return { ruleCreated: false, skipped: false, error: errorMsg };
  }
}

export async function callClaude(systemPrompt: string, userMessage: string): Promise<string | null> {
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  if (!openRouterKey) {
    console.error('[ANALYZER] OPENROUTER_API_KEY not set');
    return null;
  }
  const openRouterBaseUrl = (process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = process.env['OPENROUTER_MODEL'] ?? 'minimax/minimax-m2.7';
  const timeoutMs = parseInt(process.env['CLAUDE_TIMEOUT_MS'] ?? '30000', 10);

  try {
    const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.error(`[ANALYZER] OpenRouter API request failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error('[ANALYZER] OpenRouter call failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Calls Claude with the diff analyzer prompt.
 * Returns the raw response text or null on failure.
 */
async function callDiffAnalyzer(userMessage: string): Promise<string | null> {
  return callClaude(DIFF_ANALYZER_PROMPT, userMessage);
}
