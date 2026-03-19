import { rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LearnedRule, LearnedRulesFile } from './learned-rules.js';

const RULES_FILE = 'data/learned-rules.json';
const RULES_TMP = 'data/learned-rules.tmp.json';

// In-memory cache — null means "not yet loaded"
let cachedFile: LearnedRulesFile | null = null;

/**
 * Ensure the data/ directory exists before writing.
 */
async function ensureDataDir(): Promise<void> {
  const dir = dirname(RULES_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Read and parse the rules file from disk.
 * Returns a default empty structure if the file is missing or malformed.
 */
function readFromDisk(): LearnedRulesFile {
  try {
    if (!existsSync(RULES_FILE)) {
      return { rules: [], lastAnalyzed: null, version: 1 };
    }
    const content = readFileSync(RULES_FILE, 'utf-8');
    if (!content.trim()) {
      return { rules: [], lastAnalyzed: null, version: 1 };
    }
    const data = JSON.parse(content) as LearnedRulesFile;
    if (!Array.isArray(data.rules)) {
      console.warn('[RULES] Malformed learned-rules.json — rules field is not an array, returning empty');
      return { rules: [], lastAnalyzed: null, version: 1 };
    }
    return data;
  } catch (error) {
    console.warn('[RULES] Failed to read learned-rules.json — returning empty:', error);
    return { rules: [], lastAnalyzed: null, version: 1 };
  }
}

/**
 * Get the cached file, loading from disk if cache is empty.
 */
function getCachedFile(): LearnedRulesFile {
  if (cachedFile === null) {
    cachedFile = readFromDisk();
  }
  return cachedFile;
}

/**
 * Returns ALL rules (all statuses). Reads from file, caches in memory.
 * Returns [] if file missing or malformed.
 */
export function loadRules(): LearnedRule[] {
  return getCachedFile().rules;
}

/**
 * Returns only rules with status === 'confirmed'.
 */
export function getConfirmedRules(): LearnedRule[] {
  return getCachedFile().rules.filter((r) => r.status === 'confirmed');
}

/**
 * Atomic write: write JSON to temp file then rename to final file.
 * Updates in-memory cache AFTER write succeeds.
 */
export async function saveRules(rules: LearnedRule[]): Promise<void> {
  await ensureDataDir();

  // Preserve existing lastAnalyzed and version from cache (or defaults)
  const existing = getCachedFile();
  const fileData: LearnedRulesFile = {
    rules,
    lastAnalyzed: existing.lastAnalyzed,
    version: existing.version,
  };

  await Bun.write(RULES_TMP, JSON.stringify(fileData, null, 2) + '\n');
  await rename(RULES_TMP, RULES_FILE);

  // Update cache only after successful write
  cachedFile = fileData;
  console.log(`[RULES] Saved ${rules.length} rule(s) to ${RULES_FILE}`);
}

/**
 * Find rule by ID, apply update, save atomically.
 * Idempotent: if approving an already-confirmed rule, returns it as-is without writing.
 * Returns null if rule not found.
 */
export async function updateRule(id: string, update: Partial<LearnedRule>): Promise<LearnedRule | null> {
  const rules = loadRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) {
    console.warn(`[RULES] updateRule: rule not found — id=${id}`);
    return null;
  }

  const existing = rules[index]!;

  // Idempotency: if we're confirming and it's already confirmed, skip write
  if (update.status === 'confirmed' && existing.status === 'confirmed') {
    console.log(`[RULES] updateRule: rule ${id} is already confirmed — skipping write`);
    return existing;
  }

  const updated: LearnedRule = { ...existing, ...update };
  const newRules = [...rules];
  newRules[index] = updated;

  await saveRules(newRules);
  console.log(`[RULES] Updated rule ${id}`);
  return updated;
}

/**
 * Append rule, save atomically.
 * Throws Error('DUPLICATE_PATTERN') if exact pattern text already exists in any rule.
 */
export async function addRule(rule: LearnedRule): Promise<void> {
  const rules = loadRules();

  const duplicate = rules.find((r) => r.pattern === rule.pattern);
  if (duplicate !== undefined) {
    throw new Error('DUPLICATE_PATTERN');
  }

  await saveRules([...rules, rule]);
  console.log(`[RULES] Added rule ${rule.id} — pattern: "${rule.pattern}"`);
}

/**
 * Clears in-memory cache. Next loadRules() call re-reads from disk.
 */
export function invalidateCache(): void {
  cachedFile = null;
  console.log('[RULES] Cache invalidated — next read will load from disk');
}

/**
 * Returns lastAnalyzed from the file (or null if missing/file not found).
 */
export function getLastAnalyzed(): string | null {
  return getCachedFile().lastAnalyzed;
}

/**
 * Update lastAnalyzed in the file atomically.
 */
export async function setLastAnalyzed(timestamp: string): Promise<void> {
  await ensureDataDir();

  const existing = getCachedFile();
  const fileData: LearnedRulesFile = {
    ...existing,
    lastAnalyzed: timestamp,
  };

  await Bun.write(RULES_TMP, JSON.stringify(fileData, null, 2) + '\n');
  await rename(RULES_TMP, RULES_FILE);

  cachedFile = fileData;
  console.log(`[RULES] setLastAnalyzed → ${timestamp}`);
}
