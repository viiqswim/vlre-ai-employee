import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { NotionDB } from './db.js';
import { NotionSearcher } from './notion-search.js';
import { embeddingToBuffer } from './vector-math.js';
import type { EmbeddingModel } from './embedder.js';

function makeUnitVector(dim: number, size = 384): Float32Array {
  const v = new Float32Array(size);
  v[dim] = 1.0;
  return v;
}

function seedTestDB(db: NotionDB): void {
  db.upsertPage({ page_id: 'page-1', title: 'WiFi Guide', markdown: '...', last_edited: '2026-01-01', synced_at: 1 });
  const chunk1Embedding = makeUnitVector(0);
  db.upsertChunks('page-1', [{ heading: 'WiFi Setup', content: 'Network: TestNet\nPassword: abc123', embedding: embeddingToBuffer(chunk1Embedding) }]);

  db.upsertPage({ page_id: 'page-2', title: 'Check-in Guide', markdown: '...', last_edited: '2026-01-01', synced_at: 1 });
  const chunk2Embedding = makeUnitVector(1);
  db.upsertChunks('page-2', [{ heading: 'Check-in Process', content: 'Check-in time is 3PM', embedding: embeddingToBuffer(chunk2Embedding) }]);
}

const mockEmbedder: EmbeddingModel = {
  embed: async (_query: string) => {
    const v = new Float32Array(384);
    v[0] = 0.9;
    v[1] = 0.1;
    const norm = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1);
    return v.map(x => x / norm) as Float32Array;
  },
  embedBatch: async (texts: string[]) => Promise.all(texts.map(t => mockEmbedder.embed(t))),
  isReady: () => true,
};

describe('NotionSearcher', () => {
  let db: NotionDB;

  beforeEach(() => {
    db = new NotionDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('search() returns results sorted by score (highest first)', async () => {
    seedTestDB(db);
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 2000 });
    const results = await searcher.search('wifi');
    expect(results.length).toBe(2);
    expect(results[0]!.pageTitle).toBe('WiFi Guide');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  test('topK limit respected', async () => {
    db.upsertPage({ page_id: 'p1', title: 'P1', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    db.upsertPage({ page_id: 'p2', title: 'P2', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    db.upsertPage({ page_id: 'p3', title: 'P3', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    db.upsertPage({ page_id: 'p4', title: 'P4', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    db.upsertPage({ page_id: 'p5', title: 'P5', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    for (let i = 1; i <= 5; i++) {
      const emb = makeUnitVector(i);
      db.upsertChunks(`p${i}`, [{ heading: null, content: `Content ${i}`, embedding: embeddingToBuffer(emb) }]);
    }
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 2, maxContextChars: 2000 });
    const results = await searcher.search('test');
    expect(results.length).toBe(2);
  });

  test('empty DB returns []', async () => {
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 2000 });
    const results = await searcher.search('wifi');
    expect(results).toEqual([]);
  });

  test('formatAsContext() produces markdown sections with ### headings', async () => {
    seedTestDB(db);
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 4000 });
    const results = await searcher.search('wifi');
    const context = searcher.formatAsContext(results);
    expect(context).toContain('###');
    expect(context).toContain('WiFi Setup');
    expect(context).toContain('Network: TestNet');
  });

  test('formatAsContext() truncates to maxContextChars', async () => {
    db.upsertPage({ page_id: 'pg1', title: 'LongPage', markdown: '', last_edited: '2026-01-01', synced_at: 1 });
    db.upsertPage({ page_id: 'pg2', title: 'LongPage2', markdown: '', last_edited: '2026-01-01', synced_at: 1 });

    const longContent = 'x'.repeat(150);
    db.upsertChunks('pg1', [{ heading: 'Section A', content: longContent, embedding: embeddingToBuffer(makeUnitVector(0)) }]);
    db.upsertChunks('pg2', [{ heading: 'Section B', content: longContent, embedding: embeddingToBuffer(makeUnitVector(1)) }]);

    const TRUNCATION_MSG = '\n\n(More Notion wiki results available but truncated for context limits)';
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 200 });
    const results = await searcher.search('test');
    const context = searcher.formatAsContext(results);

    expect(context.length).toBeLessThanOrEqual(200 + TRUNCATION_MSG.length);
  });

  test('formatAsContext() includes page title in "from: PageTitle" format', async () => {
    seedTestDB(db);
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 4000 });
    const results = await searcher.search('wifi');
    const context = searcher.formatAsContext(results);
    expect(context).toContain('from: WiFi Guide');
  });

  test('formatAsContext() with empty results returns empty string', () => {
    const searcher = new NotionSearcher(db, mockEmbedder, { topK: 5, maxContextChars: 2000 });
    expect(searcher.formatAsContext([])).toBe('');
  });

  test('search() with all identical vectors returns topK results with equal scores', async () => {
    const sharedEmb = makeUnitVector(0);
    for (let i = 1; i <= 4; i++) {
      db.upsertPage({ page_id: `eq-${i}`, title: `Equal ${i}`, markdown: '', last_edited: '2026-01-01', synced_at: 1 });
      db.upsertChunks(`eq-${i}`, [{ heading: null, content: `Content ${i}`, embedding: embeddingToBuffer(sharedEmb) }]);
    }

    const identicalEmbedder: EmbeddingModel = {
      embed: async (_: string) => makeUnitVector(0),
      embedBatch: async (texts: string[]) => Promise.all(texts.map(t => identicalEmbedder.embed(t))),
      isReady: () => true,
    };

    const searcher = new NotionSearcher(db, identicalEmbedder, { topK: 3, maxContextChars: 2000 });
    const results = await searcher.search('anything');
    expect(results.length).toBe(3);
    const scores = results.map(r => r.score);
    expect(scores[0]).toBe(scores[1]);
    expect(scores[1]).toBe(scores[2]);
  });
});
