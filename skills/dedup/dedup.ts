import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
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

    if (!existsSync(this.filePath)) {
      console.log(
        `[DEDUP] No existing dedup file at ${this.filePath} — starting fresh`
      );
      return;
    }

    try {
      const content = readFileSync(this.filePath, "utf-8");
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        this.processedIds.add(line);
      }
      console.log(
        `[DEDUP] Loaded ${this.processedIds.size} processed message IDs`
      );
    } catch (error) {
      console.error(
        `[DEDUP] Failed to read dedup file: ${error} — starting fresh`
      );
    }
  }

  isProcessed(messageUid: string): boolean {
    return this.processedIds.has(messageUid);
  }

  markProcessed(messageUid: string): void {
    if (this.processedIds.has(messageUid)) return;
    this.processedIds.add(messageUid);
    try {
      appendFileSync(this.filePath, messageUid + "\n", "utf-8");
    } catch (error) {
      console.error(
        `[DEDUP] Failed to persist message ID to file: ${error}`
      );
    }
    console.log(`[DEDUP] Marked as processed: ${messageUid}`);
  }

  getProcessedCount(): number {
    return this.processedIds.size;
  }
}

export function createDeduplicator(
  filePath: string = "data/processed-messages.txt"
): WebhookDeduplicator {
  return new WebhookDeduplicator(filePath);
}
