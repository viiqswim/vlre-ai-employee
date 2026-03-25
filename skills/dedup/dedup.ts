import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { resolve, dirname } from "path";

export class WebhookDeduplicator {
  private filePath: string;
  private processedIds: Set<string>;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    this.processedIds = new Set();
    this.load();
  }

  private load(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.filePath)) {
      try {
        const content = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content) as { items?: string[] };
        for (const item of parsed.items ?? []) {
          this.processedIds.add(item);
        }
        console.log(`[DEDUP] Loaded ${this.processedIds.size} processed message IDs from JSON`);
        return;
      } catch (error) {
        console.error(`[DEDUP] Failed to read JSON dedup file: ${error} — starting fresh`);
        return;
      }
    }

    const txtPath = this.filePath.replace(/\.json$/, '.txt');
    if (txtPath !== this.filePath && existsSync(txtPath)) {
      try {
        const content = readFileSync(txtPath, "utf-8");
        const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          this.processedIds.add(line);
        }
        this.persist();
        renameSync(txtPath, txtPath + ".bak");
        console.log(`[DEDUP] Migrated ${this.processedIds.size} IDs from ${txtPath} to ${this.filePath} (.bak created)`);
        return;
      } catch (error) {
        console.error(`[DEDUP] Failed to migrate .txt dedup file: ${error} — starting fresh`);
        return;
      }
    }

    console.log(`[DEDUP] No existing dedup file at ${this.filePath} — starting fresh`);
  }

  private persist(): void {
    try {
      writeFileSync(
        this.filePath,
        JSON.stringify({ items: [...this.processedIds] }, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error(`[DEDUP] Failed to persist dedup file: ${error}`);
    }
  }

  isProcessed(messageUid: string): boolean {
    return this.processedIds.has(messageUid);
  }

  markInMemory(messageUid: string): void {
    this.processedIds.add(messageUid);
  }

  markProcessed(messageUid: string): void {
    this.processedIds.add(messageUid);
    this.persist();
    console.log(`[DEDUP] Marked as processed: ${messageUid}`);
  }

  unmarkProcessed(messageUid: string): void {
    if (!this.processedIds.has(messageUid)) return;
    this.processedIds.delete(messageUid);
    if (existsSync(this.filePath)) {
      this.persist();
    }
    console.log(`[DEDUP] Unmarked: ${messageUid}`);
  }

  getProcessedCount(): number {
    return this.processedIds.size;
  }
}

export function createDeduplicator(
  filePath: string = "data/processed-messages.json"
): WebhookDeduplicator {
  return new WebhookDeduplicator(filePath);
}
