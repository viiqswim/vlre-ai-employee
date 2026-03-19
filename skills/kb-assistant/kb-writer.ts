import { rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KBAppendResult {
  success: boolean;
  filePath: string;
  appendedText: string;
  lineStart: number;
}

const TEAM_ADDITIONS_HEADER = '## Team Additions';

async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await ensureDir(filePath);
  await Bun.write(tmpPath, content);
  await rename(tmpPath, filePath);
}

export async function appendToKB(filePath: string, entryText: string): Promise<KBAppendResult> {
  if (!entryText.trim()) throw new Error('EMPTY_ENTRY');
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const title = entryText.trim().substring(0, 60);
  const dateStr = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const entryBlock = '### ' + title + '\n' + entryText.trim() + '\n\n_Added via Slack on ' + dateStr + '_\n';
  let newContent: string;
  if (existing.includes(TEAM_ADDITIONS_HEADER)) {
    const headerIndex = existing.indexOf(TEAM_ADDITIONS_HEADER);
    const afterHeader = existing.indexOf('\n', headerIndex) + 1;
    newContent = existing.slice(0, afterHeader) + '\n' + entryBlock + existing.slice(afterHeader);
  } else {
    newContent = existing.trimEnd() + '\n\n' + TEAM_ADDITIONS_HEADER + '\n\n' + entryBlock;
  }
  const beforeAppend = newContent.slice(0, newContent.indexOf(entryBlock));
  const lineStart = (beforeAppend.match(/\n/g) ?? []).length + 1;
  await atomicWrite(filePath, newContent);
  console.log('[KB-WRITER] Appended entry to ' + filePath + ' at line ' + lineStart);
  return { success: true, filePath, appendedText: entryBlock, lineStart };
}

export async function undoAppend(filePath: string, appendedText: string): Promise<boolean> {
  if (!existsSync(filePath)) { console.warn('[KB-WRITER] undoAppend: file not found: ' + filePath); return false; }
  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes(appendedText)) { console.warn('[KB-WRITER] undoAppend: entry not found in ' + filePath); return false; }
  let newContent = content.replace(appendedText, "");
  newContent = newContent.replace(/\n{3,}/g, '\n\n');
  await atomicWrite(filePath, newContent);
  console.log('[KB-WRITER] Removed entry from ' + filePath);
  return true;
}