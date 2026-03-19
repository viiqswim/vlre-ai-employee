import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LearnedRule } from './learned-rules.js';
import { loadRules, saveRules, setLastAnalyzed } from './rules-store.js';

// ─── Config ────────────────────────────────────────────────────────────────

const AUDIT_LOG = 'logs/actions.jsonl';
const LOGS_DIR  = 'logs';

const MIN_PATTERN_FREQUENCY = 2; // minimum edits to propose a rule

// ─── Public types ──────────────────────────────────────────────────────────

export interface WeeklyAnalysisResult {
  totalEdits: number;                       // Total edit pairs analyzed
  newProposedRules: LearnedRule[];          // Rules proposed THIS run only (new, not previously proposed)
  existingConfirmedRules: LearnedRule[];    // Already-confirmed rules
  existingRejectedRules: LearnedRule[];     // Already-rejected rules
  recapMarkdownPath: string | null;         // Path to generated markdown file
}

// ─── Internal types ────────────────────────────────────────────────────────

interface AuditEntry {
  action: string;
  userId?: string;
  messageUid?: string;
  threadUid?: string;
  hostfullySendSuccess?: boolean;
  originalDraft?: string;
  editedText?: string;
  timestamp?: string;
}

interface EditPair {
  originalDraft: string;
  editedText: string;
}

interface PatternMatch {
  patternKey: string;
  pattern: string;
  correction: string;
  editPair: EditPair;
}

// ─── Pattern detection helpers ─────────────────────────────────────────────

const SIGN_OFF_PHRASES = ['regards', 'sincerely', 'best wishes', 'management team'];

function hasGreeting(text: string): boolean {
  return /^(hi |hey )/i.test(text.trim());
}

function hasSignOff(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return SIGN_OFF_PHRASES.some(phrase => lower.endsWith(phrase) || lower.includes(`\n${phrase}`));
}

// ─── Percentage helper ─────────────────────────────────────────────────────

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// ─── Main exported function ────────────────────────────────────────────────

export async function runWeeklyAnalysis(options?: { auditLogPath?: string }): Promise<WeeklyAnalysisResult> {
  const auditLogPath = options?.auditLogPath ?? AUDIT_LOG;
  const auditPath = resolve(auditLogPath);

  // ─── Read audit log ─────────────────────────────────────────────────────

  let allEntries: AuditEntry[] = [];

  if (existsSync(auditPath)) {
    const rawLines = readFileSync(auditPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim().length > 0);

    for (const line of rawLines) {
      try {
        allEntries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // skip malformed lines
      }
    }
  }

  // Count all action types for the summary table
  const actionCounts: Record<string, number> = {};
  for (const entry of allEntries) {
    const k = entry.action ?? 'unknown';
    actionCounts[k] = (actionCounts[k] ?? 0) + 1;
  }

  // Filter for edit entries with both originalDraft and editedText
  const editPairs: EditPair[] = allEntries
    .filter(
      (e): e is AuditEntry & { originalDraft: string; editedText: string } =>
        e.action === 'edit' &&
        typeof e.originalDraft === 'string' && e.originalDraft.trim().length > 0 &&
        typeof e.editedText === 'string' && e.editedText.trim().length > 0,
    )
    .map(e => ({ originalDraft: e.originalDraft, editedText: e.editedText }));

  // ─── Pattern detection ──────────────────────────────────────────────────

  const patternMatches: PatternMatch[] = [];

  for (const pair of editPairs) {
    const { originalDraft, editedText } = pair;

    // 1. Greeting removed
    if (hasGreeting(originalDraft) && !hasGreeting(editedText)) {
      patternMatches.push({
        patternKey: 'greeting-removed',
        pattern: 'AI adds greeting (Hi/Hey) before answering',
        correction: 'Answer the question directly without starting with Hi/Hey',
        editPair: pair,
      });
    }

    // 2. Sign-off removed
    if (hasSignOff(originalDraft) && !hasSignOff(editedText)) {
      patternMatches.push({
        patternKey: 'signoff-removed',
        pattern: 'AI adds sign-off or closing phrase',
        correction: 'End the message naturally after the last point, no sign-off',
        editPair: pair,
      });
    }

    // 3. Message shortened (>30% shorter)
    if (editedText.length < originalDraft.length * 0.7) {
      patternMatches.push({
        patternKey: 'message-shortened',
        pattern: 'AI responses are too long',
        correction: 'Keep responses shorter — CS team edits down to 30%+ shorter',
        editPair: pair,
      });
    }

    // 4. Message lengthened (>50% longer)
    if (editedText.length > originalDraft.length * 1.5) {
      patternMatches.push({
        patternKey: 'message-lengthened',
        pattern: 'AI responses are too short or missing context',
        correction: 'Add more context or explanation — CS team edits up to 50%+ longer',
        editPair: pair,
      });
    }
  }

  // Group matches by patternKey
  const groupedByKey: Record<string, PatternMatch[]> = {};
  for (const match of patternMatches) {
    if (!groupedByKey[match.patternKey]) groupedByKey[match.patternKey] = [];
    groupedByKey[match.patternKey]!.push(match);
  }

  // Build proposed rules (only for patterns with enough frequency)
  const proposedRules: LearnedRule[] = [];
  let ruleIndex = 0;

  for (const [, matches] of Object.entries(groupedByKey)) {
    if (matches.length < MIN_PATTERN_FREQUENCY) continue;

    const first = matches[0]!;
    const example = {
      original: first.editPair.originalDraft.substring(0, 100),
      edited:   first.editPair.editedText.substring(0, 100),
    };

    proposedRules.push({
      id:         `rule-${Date.now()}-${ruleIndex++}`,
      pattern:    first.pattern,
      correction: first.correction,
      examples:   [example],
      frequency:  matches.length,
      status:     'proposed',
      createdAt:  new Date().toISOString(),
    });
  }

  // ─── Merge with existing rules ──────────────────────────────────────────

  const existingRules = loadRules();

  // Keep confirmed/rejected rules unchanged
  const confirmedOrRejected = existingRules.filter(
    r => r.status === 'confirmed' || r.status === 'rejected',
  );

  // For proposed rules from this run: update existing proposed (same pattern), or add new
  const updatedProposed: LearnedRule[] = [];
  const newProposedRules: LearnedRule[] = []; // Only truly new proposals (not updates)

  for (const newRule of proposedRules) {
    const existing = existingRules.find(
      r => r.pattern === newRule.pattern && r.status === 'proposed',
    );
    if (existing) {
      updatedProposed.push({
        ...existing,
        frequency: newRule.frequency,
        examples:  newRule.examples,
      });
    } else {
      updatedProposed.push(newRule);
      newProposedRules.push(newRule);
    }
  }

  const mergedRules: LearnedRule[] = [...confirmedOrRejected, ...updatedProposed];

  await saveRules(mergedRules);
  await setLastAnalyzed(new Date().toISOString());

  // ─── Generate weekly recap markdown ─────────────────────────────────────

  const dateStr = new Date().toISOString().split('T')[0]!;
  const reportFileName = `weekly-recap-${dateStr}.md`;

  mkdirSync(LOGS_DIR, { recursive: true });
  const reportPath = resolve(`${LOGS_DIR}/${reportFileName}`);

  const totalActions = allEntries.length;
  const approveCount = actionCounts['approve'] ?? 0;
  const editCountAll = actionCounts['edit'] ?? 0;
  const rejectCount  = actionCounts['reject'] ?? 0;
  const totalShown   = approveCount + editCountAll + rejectCount;

  const confirmedRules = mergedRules.filter(r => r.status === 'confirmed');
  const allProposedRules = mergedRules.filter(r => r.status === 'proposed');

  let proposedSection = '';
  if (allProposedRules.length === 0) {
    proposedSection = '_No new patterns detected yet. More edits needed._';
  } else {
    for (const rule of allProposedRules) {
      const example = rule.examples[0];
      proposedSection += `### Rule: ${rule.pattern}\n`;
      proposedSection += `- **What to correct**: ${rule.correction}\n`;
      proposedSection += `- **Observed in**: ${rule.frequency} edits\n`;
      if (example) {
        proposedSection += `- **Example**:\n`;
        proposedSection += `  - AI wrote: "${example.original}"\n`;
        proposedSection += `  - CS changed to: "${example.edited}"\n`;
      }
      proposedSection += '\n';
    }
  }

  let confirmedSection = '';
  if (confirmedRules.length === 0) {
    confirmedSection = '_None yet. Confirm proposed rules by editing `data/learned-rules.json`._';
  } else {
    for (const rule of confirmedRules) {
      confirmedSection += `- **${rule.pattern}** — ${rule.correction}\n`;
    }
  }

  const report = `# Weekly Learning Recap — ${dateStr}

> Generated: ${new Date().toISOString()}
> Edits analyzed: ${editPairs.length}
> Patterns detected: ${Object.keys(groupedByKey).length}

## Summary

| Action | Count | % |
|--------|-------|---|
| Approved without edit | ${approveCount} | ${pct(approveCount, totalShown)} |
| Edited before sending | ${editCountAll} | ${pct(editCountAll, totalShown)} |
| Rejected | ${rejectCount} | ${pct(rejectCount, totalShown)} |
| Total | ${totalShown} | 100% |

> Note: ${totalActions - totalShown} log entries with other action types are not shown in the table.

## Proposed New Rules

${proposedSection.trimEnd()}

## Existing Confirmed Rules

${confirmedSection.trimEnd()}

## How to Confirm or Reject Rules

Edit \`data/learned-rules.json\` and change each rule's \`status\` field:
- \`"confirmed"\` — rule will be used in future AI responses
- \`"rejected"\` — rule will be ignored in analysis

Report generated: ${reportPath}
`;

  writeFileSync(reportPath, report, 'utf-8');

  // ─── Return result ───────────────────────────────────────────────────────

  return {
    totalEdits: editPairs.length,
    newProposedRules,
    existingConfirmedRules: confirmedOrRejected.filter(r => r.status === 'confirmed'),
    existingRejectedRules:  confirmedOrRejected.filter(r => r.status === 'rejected'),
    recapMarkdownPath: reportPath,
  };
}
