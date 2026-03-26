import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";

export interface PendingThread {
  slackTs: string;
  channelId: string;
  messageUid: string;
  guestName?: string;
  propertyName?: string;
  lastReminderSentAt?: number;
}

export class SlackThreadTracker {
  private filePath: string;
  private _threads: Map<string, PendingThread>;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    this._threads = new Map();
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
        this._threads.set(key, {
          slackTs: value.slackTs,
          channelId: value.channelId,
          messageUid: value.messageUid ?? '',
          guestName: value.guestName,
          propertyName: value.propertyName,
          lastReminderSentAt: value.lastReminderSentAt,
        });
      }
      console.log(`[THREADS] Loaded ${this._threads.size} pending thread(s)`);
    } catch (error) {
      console.error(
        `[THREADS] Failed to read thread file: ${error} — starting fresh`
      );
    }
  }

  private save(): void {
    try {
      const data: Record<string, PendingThread> = {};
      for (const [key, value] of this._threads.entries()) {
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

  track(
    hostfullyThreadUid: string,
    slackTs: string,
    channelId: string,
    messageUid: string,
    metadata?: { guestName?: string; propertyName?: string }
  ): void {
    this._threads.set(hostfullyThreadUid, {
      slackTs,
      channelId,
      messageUid,
      guestName: metadata?.guestName,
      propertyName: metadata?.propertyName,
    });
    this.save();
  }

  getPending(hostfullyThreadUid: string): PendingThread | undefined {
    return this._threads.get(hostfullyThreadUid);
  }

  getAllPending(): Record<string, PendingThread> {
    const copy: Record<string, PendingThread> = {};
    for (const [key, value] of this._threads.entries()) {
      copy[key] = value;
    }
    return copy;
  }

  updateReminderSentAt(threadUid: string, timestamp: number): void {
    const entry = this._threads.get(threadUid);
    if (entry) {
      entry.lastReminderSentAt = timestamp;
      this.save();
    }
  }

  clear(hostfullyThreadUid: string): void {
    if (this._threads.delete(hostfullyThreadUid)) {
      this.save();
    }
  }

  static getPostedAtMs(slackTs: string): number {
    return Math.floor(parseFloat(slackTs) * 1000);
  }
}

export function createThreadTracker(
  filePath: string = "data/pending-threads.json"
): SlackThreadTracker {
  return new SlackThreadTracker(filePath);
}
