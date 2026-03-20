import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface LearnedRule {
  id: string;
  pattern: string;
  correction: string;
  examples: Array<{
    original: string;
    edited: string;
  }>;
  frequency: number;
  status: 'proposed' | 'confirmed' | 'rejected' | 'pending_refinement';
  createdAt: string;
  confirmedAt?: string;
  scope?: 'global' | string;
  conditions?: string;
}

export interface LearnedRulesFile {
  rules: LearnedRule[];
  lastAnalyzed: string | null;
  version: number;
}

/**
 * Load confirmed learned rules from the rules JSON file.
 * Returns empty array if file is missing, empty, or malformed.
 * Only returns rules with status === 'confirmed'.
 */
export function loadLearnedRules(filePath: string = 'data/learned-rules.json'): LearnedRule[] {
  try {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) return [];
    const content = readFileSync(fullPath, 'utf-8');
    if (!content.trim()) return [];
    const data = JSON.parse(content) as LearnedRulesFile;
    if (!Array.isArray(data.rules)) return [];
    return data.rules
      .filter((r) => r.status === 'confirmed')
      .map((r) => ({ ...r, scope: r.scope ?? 'global' }));
  } catch (error) {
    console.warn('[PIPELINE] Failed to load learned-rules.json — running with no learned rules:', error);
    return [];
  }
}
