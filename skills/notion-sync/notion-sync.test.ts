import { test, expect, describe } from 'bun:test';
import { Client } from '@notionhq/client';
import { NotionSync } from './notion-sync.js';
import { NotionDB } from '../notion-search/db.js';
import type { EmbeddingModel } from '../notion-search/embedder.js';
import type { NotionConfig } from './config.js';

const mockEmbedder: EmbeddingModel = {
  embed: async (_text: string) => new Float32Array(384).fill(0.1),
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(384).fill(0.1)),
  isReady: () => true,
};

const testConfig: NotionConfig = {
  token: 'test-token',
  dbPath: ':memory:',
  syncIntervalHours: 1,
  maxContextChars: 2000,
  minChunkLength: 10,
  topK: 5,
};

const WIFI_MARKDOWN = `## WiFi Info
Network: TestNet
Password: TestPassword123

## House Rules  
No smoking. No pets. Quiet hours 10pm-8am.`;

type MockPage = {
  id: string;
  title: string;
  lastEdited: string;
  markdown: string;
  truncated?: boolean;
  failMarkdown?: boolean;
};

function buildMockNotionClient(pages: MockPage[]) {
  return {
    search: async (params: { start_cursor?: string }) => ({
      object: 'list',
      results: params.start_cursor ? [] : pages.map(p => ({
        object: 'page',
        id: p.id,
        last_edited_time: p.lastEdited,
        properties: {
          title: { title: [{ plain_text: p.title }] },
        },
      })),
      has_more: false,
      next_cursor: null,
    }),
    pages: {
      retrieve: async (params: { page_id: string }) => {
        const page = pages.find(p => p.id === params.page_id);
        if (!page) throw new Error(`Page not found: ${params.page_id}`);
        return {
          id: page.id,
          object: 'page',
          last_edited_time: page.lastEdited,
          properties: { title: { title: [{ plain_text: page.title }] } },
        };
      },
      retrieveMarkdown: async (params: { page_id: string }) => {
        const page = pages.find(p => p.id === params.page_id);
        if (!page) throw new Error(`Page not found: ${params.page_id}`);
        if (page.failMarkdown) throw new Error(`Simulated API failure for page ${params.page_id}`);
        return {
          object: 'page_markdown',
          id: page.id,
          markdown: page.markdown,
          truncated: page.truncated ?? false,
          unknown_block_ids: [],
        };
      },
    },
  };
}

function makeSync(pages: MockPage[], db?: NotionDB) {
  const notion = buildMockNotionClient(pages) as unknown as Client;
  const realDb = db ?? new NotionDB(':memory:');
  return { sync: new NotionSync(notion, realDb, mockEmbedder, testConfig, 0), db: realDb };
}

describe('NotionSync', () => {
  test('successful sync — 2 pages get stored with chunks', async () => {
    const pages: MockPage[] = [
      { id: 'page-1', title: 'Page One', lastEdited: '2026-03-01T00:00:00.000Z', markdown: WIFI_MARKDOWN },
      { id: 'page-2', title: 'Page Two', lastEdited: '2026-03-02T00:00:00.000Z', markdown: WIFI_MARKDOWN },
    ];
    const { sync } = makeSync(pages);
    const result = await sync.syncAll();

    expect(result.pagesTotal).toBe(2);
    expect(result.pagesUpdated).toBe(2);
    expect(result.pagesSkipped).toBe(0);
    expect(result.chunksTotal).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  test('skip unchanged page — second sync skips both pages', async () => {
    const pages: MockPage[] = [
      { id: 'page-1', title: 'Page One', lastEdited: '2026-03-01T00:00:00.000Z', markdown: WIFI_MARKDOWN },
      { id: 'page-2', title: 'Page Two', lastEdited: '2026-03-02T00:00:00.000Z', markdown: WIFI_MARKDOWN },
    ];
    const db = new NotionDB(':memory:');
    const { sync } = makeSync(pages, db);

    await sync.syncAll();
    const result2 = await sync.syncAll();

    expect(result2.pagesSkipped).toBe(2);
    expect(result2.pagesUpdated).toBe(0);
  });

  test('truncated page is recorded in truncatedPages', async () => {
    const pages: MockPage[] = [
      { id: 'page-1', title: 'Truncated Page', lastEdited: '2026-03-01T00:00:00.000Z', markdown: WIFI_MARKDOWN, truncated: true },
    ];
    const { sync } = makeSync(pages);
    const result = await sync.syncAll();

    expect(result.truncatedPages).toHaveLength(1);
    expect(result.truncatedPages[0]).toBe('page-1');
  });

  test('orphan cleanup — removed page triggers deleteOrphanedPages', async () => {
    const pages: MockPage[] = [
      { id: 'page-1', title: 'Page One', lastEdited: '2026-03-01T00:00:00.000Z', markdown: WIFI_MARKDOWN },
      { id: 'page-2', title: 'Page Two', lastEdited: '2026-03-02T00:00:00.000Z', markdown: WIFI_MARKDOWN },
    ];
    const db = new NotionDB(':memory:');
    const notion1 = buildMockNotionClient(pages) as unknown as Client;
    const sync1 = new NotionSync(notion1, db, mockEmbedder, testConfig, 0);
    await sync1.syncAll();

    const pagesAfterRemoval: MockPage[] = [pages[0]!];
    const notion2 = buildMockNotionClient(pagesAfterRemoval) as unknown as Client;
    const sync2 = new NotionSync(notion2, db, mockEmbedder, testConfig, 0);
    const result = await sync2.syncAll();

    expect(result.orphansRemoved).toBe(1);
  });

  test('API error for one page does not crash sync — other page succeeds', async () => {
    const pages: MockPage[] = [
      { id: 'page-1', title: 'Page One', lastEdited: '2026-03-01T00:00:00.000Z', markdown: WIFI_MARKDOWN },
      { id: 'page-2', title: 'Failing Page', lastEdited: '2026-03-02T00:00:00.000Z', markdown: '', failMarkdown: true },
    ];
    const { sync } = makeSync(pages);
    const result = await sync.syncAll();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.pageId).toBe('page-2');
    expect(result.pagesUpdated).toBe(1);
  });

  test('empty workspace — zero pages, no errors', async () => {
    const { sync } = makeSync([]);
    const result = await sync.syncAll();

    expect(result.pagesTotal).toBe(0);
    expect(result.pagesUpdated).toBe(0);
    expect(result.pagesSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('syncPage() — single page appears in DB after sync', async () => {
    const pages: MockPage[] = [
      { id: 'page-solo', title: 'Solo Page', lastEdited: '2026-03-05T00:00:00.000Z', markdown: WIFI_MARKDOWN },
    ];
    const { sync, db } = makeSync(pages);

    await sync.syncPage('page-solo');

    const lastEdited = db.getPageLastEdited('page-solo');
    expect(lastEdited).toBe('2026-03-05T00:00:00.000Z');
  });
});
