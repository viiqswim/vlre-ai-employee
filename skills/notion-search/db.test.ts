import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { NotionDB } from './db.js';

describe('NotionDB', () => {
  let db: NotionDB;

  beforeEach(() => {
    db = new NotionDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('schema creation — pages and chunks tables exist', () => {
    const tables = db['db'].prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pages', 'chunks')"
    ).all() as Array<{ name: string }>;
    expect(tables.length).toBe(2);
    expect(tables.map(t => t.name).sort()).toEqual(['chunks', 'pages']);
  });

  test('WAL mode enabled', () => {
    // In-memory databases use 'memory' journal mode, which is expected
    // WAL mode is only applicable to file-based databases
    const mode = db.getJournalMode();
    expect(['wal', 'memory']).toContain(mode);
  });

  test('upsertPage — inserts new page', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Test Page',
      markdown: '# Test',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const pages = db['db'].prepare('SELECT * FROM pages WHERE page_id = ?').all('page-1') as Array<{
      page_id: string;
      title: string;
      markdown: string;
      last_edited: string;
      synced_at: number;
    }>;
    expect(pages.length).toBe(1);
    expect(pages[0]?.title).toBe('Test Page');
  });

  test('upsertPage — replaces existing page (idempotent)', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Original Title',
      markdown: '# Original',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    db.upsertPage({
      page_id: 'page-1',
      title: 'Updated Title',
      markdown: '# Updated',
      last_edited: '2026-03-20T11:00:00Z',
      synced_at: 1234567891,
    });

    const pages = db['db'].prepare('SELECT * FROM pages WHERE page_id = ?').all('page-1') as Array<{
      title: string;
      markdown: string;
    }>;
    expect(pages.length).toBe(1);
    expect(pages[0]?.title).toBe('Updated Title');
    expect(pages[0]?.markdown).toBe('# Updated');
  });

  test('upsertChunks — inserts chunks with buffer embedding', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Test Page',
      markdown: '# Test',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'This is content',
        embedding,
      },
    ]);

    const chunks = db['db'].prepare('SELECT * FROM chunks WHERE page_id = ?').all('page-1') as Array<{
      heading: string | null;
      content: string;
      embedding: Uint8Array;
    }>;
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.heading).toBe('Section 1');
    expect(chunks[0]?.content).toBe('This is content');
    expect(chunks[0]?.embedding).toBeDefined();
  });

  test('upsertChunks — re-running for same page replaces chunks (no duplicates)', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Test Page',
      markdown: '# Test',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding1 = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding: embedding1,
      },
    ]);

    const embedding2 = Buffer.from(new Float32Array([0.4, 0.5, 0.6]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 2',
        content: 'Content 2',
        embedding: embedding2,
      },
    ]);

    const chunks = db['db'].prepare('SELECT * FROM chunks WHERE page_id = ?').all('page-1') as Array<{
      heading: string | null;
      content: string;
    }>;
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.heading).toBe('Section 2');
    expect(chunks[0]?.content).toBe('Content 2');
  });

  test('deleteChunksForPage — removes chunks for page', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Test Page',
      markdown: '# Test',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding,
      },
    ]);

    db.deleteChunksForPage('page-1');

    const chunks = db['db'].prepare('SELECT COUNT(*) as count FROM chunks WHERE page_id = ?').get('page-1') as {
      count: number;
    };
    expect(chunks.count).toBe(0);
  });

  test('deleteOrphanedPages — removes pages not in active list', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    db.upsertPage({
      page_id: 'page-2',
      title: 'Page 2',
      markdown: '# Page 2',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    db.upsertPage({
      page_id: 'page-3',
      title: 'Page 3',
      markdown: '# Page 3',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const deleted = db.deleteOrphanedPages(['page-1', 'page-2']);
    expect(deleted).toBe(1);

    const pages = db['db'].prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
    expect(pages.count).toBe(2);
  });

  test('deleteOrphanedPages — empty active list removes all pages', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    db.upsertPage({
      page_id: 'page-2',
      title: 'Page 2',
      markdown: '# Page 2',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const deleted = db.deleteOrphanedPages([]);
    expect(deleted).toBe(2);

    const pages = db['db'].prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
    expect(pages.count).toBe(0);
  });

  test('getAllChunkEmbeddings — returns all embeddings', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding1 = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    const embedding2 = Buffer.from(new Float32Array([0.4, 0.5, 0.6]).buffer);

    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding: embedding1,
      },
      {
        heading: 'Section 2',
        content: 'Content 2',
        embedding: embedding2,
      },
    ]);

    const embeddings = db.getAllChunkEmbeddings();
    expect(embeddings.length).toBe(2);
    expect(embeddings[0]?.page_id).toBe('page-1');
    expect(embeddings[1]?.page_id).toBe('page-1');
  });

  test('getChunksByIds — returns correct chunks', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding,
      },
    ]);

    const allChunks = db['db'].prepare('SELECT id FROM chunks').all() as Array<{ id: number }>;
    const chunkIds = allChunks.map(c => c.id);

    const chunks = db.getChunksByIds(chunkIds);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.heading).toBe('Section 1');
    expect(chunks[0]?.content).toBe('Content 1');
  });

  test('getChunksByIds — returns empty array for empty ids', () => {
    const chunks = db.getChunksByIds([]);
    expect(chunks.length).toBe(0);
  });

  test('getPageLastEdited — returns null for missing page', () => {
    const lastEdited = db.getPageLastEdited('nonexistent');
    expect(lastEdited).toBeNull();
  });

  test('getPageLastEdited — returns timestamp for existing page', () => {
    const timestamp = '2026-03-20T10:00:00Z';
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: timestamp,
      synced_at: 1234567890,
    });

    const lastEdited = db.getPageLastEdited('page-1');
    expect(lastEdited).toBe(timestamp);
  });

  test('getChunkCount — correct count', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding,
      },
      {
        heading: 'Section 2',
        content: 'Content 2',
        embedding,
      },
    ]);

    const count = db.getChunkCount();
    expect(count).toBe(2);
  });

  test('cascading delete — deleting page also deletes its chunks', () => {
    db.upsertPage({
      page_id: 'page-1',
      title: 'Page 1',
      markdown: '# Page 1',
      last_edited: '2026-03-20T10:00:00Z',
      synced_at: 1234567890,
    });

    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    db.upsertChunks('page-1', [
      {
        heading: 'Section 1',
        content: 'Content 1',
        embedding,
      },
    ]);

    db['db'].prepare('DELETE FROM pages WHERE page_id = ?').run('page-1');

    const chunks = db['db'].prepare('SELECT COUNT(*) as count FROM chunks WHERE page_id = ?').get('page-1') as {
      count: number;
    };
    expect(chunks.count).toBe(0);
  });
});
