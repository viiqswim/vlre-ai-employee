import { Client } from '@notionhq/client';
import type { NotionDB } from '../notion-search/db.js';
import type { EmbeddingModel } from '../notion-search/embedder.js';
import type { NotionConfig } from './config.js';
import { chunkMarkdown } from './chunker.js';
import { embeddingToBuffer } from '../notion-search/vector-math.js';

export interface SyncResult {
  pagesTotal: number;
  pagesUpdated: number;
  pagesSkipped: number;
  chunksTotal: number;
  orphansRemoved: number;
  truncatedPages: string[];
  errors: Array<{ pageId: string; error: string }>;
  durationMs: number;
}

type NotionPageResult = {
  id: string;
  object: string;
  last_edited_time: string;
  properties?: Record<string, unknown>;
};

export class NotionSync {
  constructor(
    private readonly notion: Client,
    private readonly db: NotionDB,
    private readonly embedder: EmbeddingModel,
    private readonly config: NotionConfig,
    private readonly _delayMs: number = 350,
  ) {}

  async syncAll(): Promise<SyncResult> {
    const startMs = Date.now();
    const result: SyncResult = {
      pagesTotal: 0,
      pagesUpdated: 0,
      pagesSkipped: 0,
      chunksTotal: 0,
      orphansRemoved: 0,
      truncatedPages: [],
      errors: [],
      durationMs: 0,
    };

    // 1. Collect ALL accessible pages via paginated search
    const allPages: Array<{ id: string; title: string; lastEdited: string }> = [];
    let cursor: string | undefined = undefined;
    do {
      const response = await this.notion.search({
        filter: { property: 'object', value: 'page' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const item of response.results) {
        if (item.object !== 'page') continue;
        const page = item as NotionPageResult;
        const title = this.extractTitle(page);
        allPages.push({ id: page.id, title, lastEdited: page.last_edited_time });
      }
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    result.pagesTotal = allPages.length;
    const activePageIds = allPages.map(p => p.id);

    // 2. Process each page
    for (const page of allPages) {
      await this.delay(this._delayMs);
      try {
        const storedLastEdited = this.db.getPageLastEdited(page.id);
        if (storedLastEdited === page.lastEdited) {
          result.pagesSkipped++;
          continue;
        }

        const markdownResponse = await this.notion.pages.retrieveMarkdown({ page_id: page.id });

        if (markdownResponse.truncated) {
          console.warn(`[NOTION-SYNC] WARNING: page ${page.id} content truncated`);
          result.truncatedPages.push(page.id);
        }

        const markdown = markdownResponse.markdown;
        const chunks = chunkMarkdown(markdown, { minChunkLength: this.config.minChunkLength });
        const embeddings = await this.embedder.embedBatch(chunks.map(c => c.content));

        this.db.upsertPage({
          page_id: page.id,
          title: page.title,
          markdown,
          last_edited: page.lastEdited,
          synced_at: Date.now(),
        });
        this.db.upsertChunks(
          page.id,
          chunks.map((chunk, i) => ({
            heading: chunk.heading,
            content: chunk.content,
            embedding: embeddingToBuffer(embeddings[i] ?? new Float32Array(384)),
          }))
        );

        result.pagesUpdated++;
        result.chunksTotal += chunks.length;
      } catch (error) {
        const errorMsg = (error as Error).message ?? String(error);
        console.error(`[NOTION-SYNC] Error syncing page ${page.id}: ${errorMsg}`);
        result.errors.push({ pageId: page.id, error: errorMsg });
      }
    }

    // 3. Remove orphaned pages
    // Count orphans by comparing stored page IDs against active set before deletion,
    // because deleteOrphanedPages().changes includes cascade-deleted chunk rows in bun:sqlite.
    const activeSet = new Set(activePageIds);
    const storedIds = this.db.getAllPageIds();
    const orphanCount = storedIds.filter(id => !activeSet.has(id)).length;
    this.db.deleteOrphanedPages(activePageIds);
    result.orphansRemoved = orphanCount;

    result.durationMs = Date.now() - startMs;
    return result;
  }

  async syncPage(pageId: string): Promise<void> {
    try {
      const pageResponse = await this.notion.pages.retrieve({ page_id: pageId });
      const page = pageResponse as NotionPageResult;
      const title = this.extractTitle(page);

      const markdownResponse = await this.notion.pages.retrieveMarkdown({ page_id: pageId });
      if (markdownResponse.truncated) {
        console.warn(`[NOTION-SYNC] WARNING: page ${pageId} content truncated`);
      }

      const chunks = chunkMarkdown(markdownResponse.markdown, { minChunkLength: this.config.minChunkLength });
      const embeddings = await this.embedder.embedBatch(chunks.map(c => c.content));

      this.db.upsertPage({
        page_id: pageId,
        title,
        markdown: markdownResponse.markdown,
        last_edited: page.last_edited_time,
        synced_at: Date.now(),
      });
      this.db.upsertChunks(
        pageId,
        chunks.map((chunk, i) => ({
          heading: chunk.heading,
          content: chunk.content,
          embedding: embeddingToBuffer(embeddings[i] ?? new Float32Array(384)),
        }))
      );
    } catch (error) {
      console.error(`[NOTION-SYNC] Error syncing page ${pageId}:`, (error as Error).message);
      throw error;
    }
  }

  private extractTitle(page: { properties?: Record<string, unknown> }): string {
    const props = page.properties;
    if (!props) return 'Untitled';

    for (const key of ['title', 'Title', 'Name', 'name']) {
      const prop = props[key] as { title?: Array<{ plain_text?: string }> } | undefined;
      if (prop?.title?.[0]?.plain_text) return prop.title[0].plain_text;
    }
    return 'Untitled';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function createNotionSync(
  notion: Client,
  db: NotionDB,
  embedder: EmbeddingModel,
  config: NotionConfig,
  delayMs: number = 350,
): NotionSync {
  return new NotionSync(notion, db, embedder, config, delayMs);
}
