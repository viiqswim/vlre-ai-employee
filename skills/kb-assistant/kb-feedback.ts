import { rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KBFeedbackEntry {
  id: string;
  type: 'correct' | 'incorrect';
  question: string;
  aiAnswer: string;
  correction?: string;
  filePath: string;
  userId: string;
  timestamp: string;
}

export interface KBFeedbackFile {
  entries: KBFeedbackEntry[];
  version: number;
}

function getFeedbackFile(): string {
  return process.env['KB_FEEDBACK_FILE'] ?? 'data/kb-feedback.json';
}

function getFeedbackTmp(): string {
  return getFeedbackFile().replace('.json', '.tmp.json');
}

// In-memory cache — null means "not yet loaded"
let cachedFile: KBFeedbackFile | null = null;

/**
 * Ensure the data/ directory exists before writing.
 */
async function ensureDataDir(): Promise<void> {
  const dir = dirname(getFeedbackFile());
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Read and parse the feedback file from disk.
 * Returns a default empty structure if the file is missing or malformed.
 */
function readFromDisk(): KBFeedbackFile {
  const feedbackFile = getFeedbackFile();
  try {
    if (!existsSync(feedbackFile)) {
      return { entries: [], version: 1 };
    }
    const content = readFileSync(feedbackFile, 'utf-8');
    if (!content.trim()) {
      return { entries: [], version: 1 };
    }
    const data = JSON.parse(content) as KBFeedbackFile;
    if (!Array.isArray(data.entries)) {
      console.warn('[KB-FEEDBACK] Malformed kb-feedback.json — entries field is not an array, returning empty');
      return { entries: [], version: 1 };
    }
    return data;
  } catch (error) {
    console.warn('[KB-FEEDBACK] Failed to read kb-feedback.json — returning empty:', error);
    return { entries: [], version: 1 };
  }
}

/**
 * Get the cached file, loading from disk if cache is empty.
 */
function getCachedFile(): KBFeedbackFile {
  if (cachedFile === null) {
    cachedFile = readFromDisk();
  }
  return cachedFile;
}

/**
 * Generate a unique ID for a feedback entry.
 * Uses crypto.randomUUID() if available, falls back to timestamp + random string.
 */
function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

/**
 * Record feedback for a KB answer.
 * Generates id and timestamp automatically.
 * Appends to entries array, writes atomically.
 */
export async function recordFeedback(
  entry: Omit<KBFeedbackEntry, 'id' | 'timestamp'>
): Promise<void> {
  await ensureDataDir();

  const existing = getCachedFile();
  const newEntry: KBFeedbackEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };

  const fileData: KBFeedbackFile = {
    entries: [...existing.entries, newEntry],
    version: existing.version,
  };

  const feedbackFile = getFeedbackFile();
  const feedbackTmp = getFeedbackTmp();
  await Bun.write(feedbackTmp, JSON.stringify(fileData, null, 2) + '\n');
  await rename(feedbackTmp, feedbackFile);

  cachedFile = fileData;
  console.log(`[KB-FEEDBACK] Recorded feedback entry ${newEntry.id}`);
}

/**
 * Load all feedback entries from cache or disk.
 * Returns [] if file missing or malformed.
 */
export function loadFeedback(): KBFeedbackEntry[] {
  return getCachedFile().entries;
}

/**
 * Clears in-memory cache. Next loadFeedback() call re-reads from disk.
 */
export function invalidateCache(): void {
  cachedFile = null;
  console.log('[KB-FEEDBACK] Cache invalidated — next read will load from disk');
}
