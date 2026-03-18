import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";

interface PendingThread {
  slackTs: string;
  channelId: string;
}

export class SlackThreadTracker {
  private filePath: string;
  private threads: Map<string, PendingThread>;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    this.threads = new Map();
    this.load();
  }

  private load(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(content) as Record<string, PendingThread>;
      for (const [key, value] of Object.entries(data)) {
        this.threads.set(key, value);
      }
      console.log(`[THREADS] Loaded ${this.threads.size} pending thread(s)`);
    } catch (error) {
      console.error(
        `[THREADS] Failed to read thread file: ${error} — starting fresh`
      );
    }
  }

  private save(): void {
    try {
      const data: Record<string, PendingThread> = {};
      for (const [key, value] of this.threads.entries()) {
        data[key] = value;
      }
      writeFileSync(
        this.filePath,
        JSON.stringify(data, null, 2) + "\n",
        "utf-8"
      );
    } catch (error) {
      console.error(`[THREADS] Failed to persist thread state: ${error}`);
    }
  }

  track(hostfullyThreadUid: string, slackTs: string, channelId: string): void {
    this.threads.set(hostfullyThreadUid, { slackTs, channelId });
    this.save();
  }

  getPending(hostfullyThreadUid: string): PendingThread | undefined {
    return this.threads.get(hostfullyThreadUid);
  }

  clear(hostfullyThreadUid: string): void {
    if (this.threads.delete(hostfullyThreadUid)) {
      this.save();
    }
  }
}

export function createThreadTracker(
  filePath: string = "data/pending-threads.json"
): SlackThreadTracker {
  return new SlackThreadTracker(filePath);
}
