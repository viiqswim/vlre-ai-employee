import { callClaude } from './real-time-analyzer.js';
import { RULE_REFINER_PROMPT } from './rule-refiner-prompt.js';

interface RefinedRuleResponse {
  pattern: string;
  correction: string;
  scope: string;
  skip: boolean;
  skipReason?: string | null;
}

export async function refineRuleWithClaude(params: {
  originalPattern: string;
  originalCorrection: string;
  refinedText: string;
  conditions: string;
  scope: string;
}): Promise<{ pattern: string; correction: string; scope: string } | null> {
  const userMessage = `ORIGINAL_PATTERN: ${params.originalPattern}
ORIGINAL_CORRECTION: ${params.originalCorrection}
REFINED_TEXT: ${params.refinedText}
CONDITIONS: ${params.conditions}
SCOPE: ${params.scope}`;

  let responseJson: string | null;
  try {
    responseJson = await callClaude(RULE_REFINER_PROMPT, userMessage);
  } catch (error) {
    console.error('[REFINER] Error calling Claude:', error instanceof Error ? error.message : String(error));
    return null;
  }

  if (!responseJson) {
    console.error('[REFINER] Claude returned empty response');
    return null;
  }

  let analysis: RefinedRuleResponse;
  try {
    analysis = JSON.parse(responseJson) as RefinedRuleResponse;
  } catch {
    console.error('[REFINER] Failed to parse Claude response as JSON:', responseJson.substring(0, 200));
    return null;
  }

  if (analysis.skip) {
    console.log(`[REFINER] Claude said skip: ${analysis.skipReason ?? 'no reason given'}`);
    return null;
  }

  if (!analysis.pattern || !analysis.correction) {
    console.log('[REFINER] Empty pattern or correction — returning null');
    return null;
  }

  return { pattern: analysis.pattern, correction: analysis.correction, scope: analysis.scope };
}
