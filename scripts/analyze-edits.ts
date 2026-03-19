#!/usr/bin/env zx
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { LearnedRule, LearnedRulesFile } from '../skills/pipeline/learned-rules.js';

// ─── Config ────────────────────────────────────────────────────────────────

const AUDIT_LOG  = 'logs/actions.jsonl';
const RULES_FILE = 'data/learned-rules.json';
const LOGS_DIR   = 'logs';
const DATA_DIR   = 'data';

const MIN_PATTERN_FREQUENCY = 2; // minimum edits to propose a rule

// ─── Color helpers ─────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
};
const green  = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const cyan   = (s: string) => `${c.cyan}${s}${c.reset}`;
const dim    = (s: string) => `${c.dim}${s}${c.reset}`;
const bold   = (s: string) => `${c.bold}${s}${c.reset}`;

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Read audit log ─────────────────────────────────────────────────────────

const auditPath = resolve(AUDIT_LOG);

if (!existsSync(auditPath)) {
  console.log(yellow('⚠️  No audit log found at logs/actions.jsonl'));
  console.log(dim('   Run the service first to generate audit data.'));
  process.exit(0);
}

const rawLines = readFileSync(auditPath, 'utf-8')
  .split('\n')
  .filter(line => line.trim().length > 0);

const allEntries: AuditEntry[] = [];
for (const line of rawLines) {
  try {
    allEntries.push(JSON.parse(line) as AuditEntry);
  } catch {
    // skip malformed lines
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

const editCount = allEntries.filter(e => e.action === 'edit').length;

if (editPairs.length === 0) {
  if (editCount === 0) {
    console.log(yellow('ℹ️  No edit data found yet.'));
    console.log(dim('   This script analyzes edits made after the learning feature was deployed.'));
  } else {
    console.log(yellow(`ℹ️  Found ${editCount} edit entries but none have originalDraft + editedText data.`));
    console.log(dim('   These are older entries recorded before the learning feature was deployed.'));
  }
  process.exit(0);
}

if (editPairs.length < MIN_PATTERN_FREQUENCY) {
  console.log(yellow(`ℹ️  Only ${editPairs.length} edit(s) found with full data.`));
  console.log(dim(`   Collecting more data before patterns can be detected (need ${MIN_PATTERN_FREQUENCY}+).`));
  process.exit(0);
}

console.log(bold(`\n📊 Analyzing ${editPairs.length} edit(s)...\n`));

// ─── Pattern detection ──────────────────────────────────────────────────────

const SIGN_OFF_PHRASES = ['regards', 'sincerely', 'best wishes', 'management team'];

function hasGreeting(text: string): boolean {
  return /^(hi |hey )/i.test(text.trim());
}

function hasSignOff(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return SIGN_OFF_PHRASES.some(phrase => lower.endsWith(phrase) || lower.includes(`\n${phrase}`));
}

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

console.log(dim(`Patterns detected: ${Object.keys(groupedByKey).length} (${proposedRules.length} meet threshold)`));

// ─── Merge with existing rules ──────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let existingData: LearnedRulesFile = { rules: [], lastAnalyzed: null, version: 1 };

if (existsSync(resolve(RULES_FILE))) {
  try {
    const raw = readFileSync(resolve(RULES_FILE), 'utf-8');
    if (raw.trim()) {
      existingData = JSON.parse(raw) as LearnedRulesFile;
      if (!Array.isArray(existingData.rules)) existingData.rules = [];
    }
  } catch {
    // start fresh if file is malformed
  }
}

// Keep confirmed/rejected rules unchanged; update or add proposed rules
const confirmedOrRejected = existingData.rules.filter(
  r => r.status === 'confirmed' || r.status === 'rejected',
);

// For proposed rules from this run: update existing proposed, or add new
const updatedProposed: LearnedRule[] = [];

for (const newRule of proposedRules) {
  const existing = existingData.rules.find(
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
  }
}

const mergedRules: LearnedRule[] = [...confirmedOrRejected, ...updatedProposed];

const updatedData: LearnedRulesFile = {
  rules:        mergedRules,
  lastAnalyzed: new Date().toISOString(),
  version:      existingData.version ?? 1,
};

writeFileSync(resolve(RULES_FILE), JSON.stringify(updatedData, null, 2), 'utf-8');
console.log(green(`✅ Rules written to ${RULES_FILE}`));

// ─── Generate weekly recap markdown ─────────────────────────────────────────

const dateStr = new Date().toISOString().split('T')[0]!;
const reportFileName = `weekly-recap-${dateStr}.md`;
const reportPath = resolve(`${LOGS_DIR}/${reportFileName}`);

const totalActions = allEntries.length;
const approveCount = actionCounts['approve'] ?? 0;
const editCountAll = actionCounts['edit'] ?? 0;
const rejectCount  = actionCounts['reject'] ?? 0;
const totalShown   = approveCount + editCountAll + rejectCount;

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

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

if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

writeFileSync(reportPath, report, 'utf-8');

console.log(green(`✅ Report written to: ${cyan(reportPath)}`));
console.log();
console.log(bold('📋 Summary:'));
console.log(`   ${dim('Edits analyzed:')}   ${editPairs.length}`);
console.log(`   ${dim('Patterns found:')}   ${Object.keys(groupedByKey).length}`);
console.log(`   ${dim('Rules proposed:')}   ${allProposedRules.length}`);
console.log(`   ${dim('Rules confirmed:')}  ${confirmedRules.length}`);
console.log();
console.log(dim(`Report: ${reportPath}`));
