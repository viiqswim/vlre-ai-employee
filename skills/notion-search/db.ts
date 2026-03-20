import { Database } from 'bun:sqlite';

export interface PageRow {
  page_id: string;
  title: string;
  markdown: string;
  last_edited: string;
  synced_at: number;
}

export interface ChunkRow {
  id: number;
  page_id: string;
  page_title: string;
  heading: string | null;
  content: string;
  embedding: Buffer;
}

export class NotionDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        page_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        last_edited TEXT NOT NULL,
        synced_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
        heading TEXT,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        UNIQUE(page_id, heading, content)
      );
    `);
  }

  upsertPage(page: PageRow): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pages (page_id, title, markdown, last_edited, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(page.page_id, page.title, page.markdown, page.last_edited, page.synced_at);
  }

  upsertChunks(
    pageId: string,
    chunks: Array<{ heading: string | null; content: string; embedding: Buffer }>
  ): void {
    const deleteStmt = this.db.prepare('DELETE FROM chunks WHERE page_id = ?');
    const insertStmt = this.db.prepare(
      'INSERT OR IGNORE INTO chunks (page_id, heading, content, embedding) VALUES (?, ?, ?, ?)'
    );
    const doTransaction = this.db.transaction(() => {
      deleteStmt.run(pageId);
      for (const chunk of chunks) {
        insertStmt.run(pageId, chunk.heading, chunk.content, chunk.embedding);
      }
    });
    doTransaction();
  }

  deleteChunksForPage(pageId: string): void {
    this.db.prepare('DELETE FROM chunks WHERE page_id = ?').run(pageId);
  }

  deleteOrphanedPages(activePageIds: string[]): number {
    if (activePageIds.length === 0) {
      const count = (this.db.prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number }).count;
      this.db.exec('DELETE FROM pages');
      return count;
    }
    const placeholders = activePageIds.map(() => '?').join(',');
    const result = this.db.prepare(
      `DELETE FROM pages WHERE page_id NOT IN (${placeholders})`
    ).run(...activePageIds);
    return result.changes;
  }

  getAllChunkEmbeddings(): Array<{ id: number; page_id: string; embedding: Buffer }> {
    return this.db.prepare(
      'SELECT id, page_id, embedding FROM chunks'
    ).all() as Array<{ id: number; page_id: string; embedding: Buffer }>;
  }

  getChunksByIds(ids: number[]): ChunkRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT c.id, c.page_id, p.title as page_title, c.heading, c.content, c.embedding
       FROM chunks c JOIN pages p ON c.page_id = p.page_id
       WHERE c.id IN (${placeholders})`
    ).all(...ids) as ChunkRow[];
  }

  getPageLastEdited(pageId: string): string | null {
    const row = this.db.prepare(
      'SELECT last_edited FROM pages WHERE page_id = ?'
    ).get(pageId) as { last_edited: string } | undefined;
    return row?.last_edited ?? null;
  }

  getAllPageIds(): string[] {
    return (this.db.prepare('SELECT page_id FROM pages').all() as Array<{ page_id: string }>).map(r => r.page_id);
  }

  getChunkCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
  }

  getJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string } | undefined;
    return row?.journal_mode ?? 'unknown';
  }

  close(): void {
    this.db.close();
  }
}

export function createNotionDB(dbPath: string = 'data/notion-embeddings.db'): NotionDB {
  return new NotionDB(dbPath);
}
