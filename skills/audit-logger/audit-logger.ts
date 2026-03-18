/**
 * Audit Logger Skill
 *
 * Appends JSON-formatted audit log entries to a file.
 * Each entry is a single line of JSON with an auto-generated timestamp.
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Appends an audit log entry to a file.
 * Creates the directory if it doesn't exist.
 * Each entry is a JSON line with an auto-generated timestamp.
 *
 * @param entry - The audit log entry object
 * @param logFile - Path to the log file (default: 'logs/actions.jsonl')
 */
export async function appendAuditLog(
  entry: Record<string, unknown>,
  logFile: string = 'logs/actions.jsonl'
): Promise<void> {
  // Ensure directory exists
  const dir = dirname(logFile);
  await mkdir(dir, { recursive: true });

  // Add timestamp to entry
  const entryWithTimestamp = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  // Append as JSON line
  const line = JSON.stringify(entryWithTimestamp) + '\n';
  await appendFile(logFile, line, 'utf-8');
}

/**
 * Factory function that creates a bound audit logger function.
 * Useful for dependency injection or partial application.
 *
 * @param logFile - Path to the log file (default: 'logs/actions.jsonl')
 * @returns A function that appends entries to the specified log file
 */
export function createAuditLogger(logFile: string = 'logs/actions.jsonl') {
  return (entry: Record<string, unknown>) => appendAuditLog(entry, logFile);
}
