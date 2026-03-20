import type { NotionDB } from './db.js';
import type { EmbeddingModel } from './embedder.js';
import { topKBySimilarity, bufferToEmbedding } from './vector-math.js';

export interface SearchResult {
  heading: string | null;
  content: string;
  pageTitle: string;
  score: number;
}

export class NotionSearcher {
  constructor(
    private readonly db: NotionDB,
    private readonly embedder: EmbeddingModel,
    private readonly config: { topK: number; maxContextChars: number }
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    // 1. Load all chunk embeddings from DB
    const allChunks = this.db.getAllChunkEmbeddings();
    if (allChunks.length === 0) return [];

    // 2. Embed the query
    const queryEmbedding = await this.embedder.embed(query);

    // 3. Compute cosine similarity, get top-K
    const candidates = allChunks.map(c => ({
      id: c.id,
      embedding: bufferToEmbedding(c.embedding),
    }));
    const topK = topKBySimilarity(queryEmbedding, candidates, this.config.topK);

    // 4. Fetch full chunk data
    const chunkIds = topK.map(r => r.id);
    const chunkRows = this.db.getChunksByIds(chunkIds);

    // Map scores back to rows
    const scoreMap = new Map(topK.map(r => [r.id, r.score]));

    // Return sorted by score (highest first)
    return chunkRows
      .map(row => ({
        heading: row.heading,
        content: row.content,
        pageTitle: row.page_title,
        score: scoreMap.get(row.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  formatAsContext(results: SearchResult[]): string {
    if (results.length === 0) return '';

    const sections: string[] = [];
    let totalChars = 0;
    const TRUNCATION_MSG = '\n\n(More Notion wiki results available but truncated for context limits)';
    const MAX_CHARS = this.config.maxContextChars - TRUNCATION_MSG.length;

    for (const result of results) {
      const section = result.heading
        ? `### ${result.heading} (from: ${result.pageTitle})\n${result.content}`
        : `### ${result.pageTitle}\n${result.content}`;

      if (totalChars + section.length > MAX_CHARS && sections.length > 0) {
        // Adding this section would exceed limit — truncate
        sections.push(TRUNCATION_MSG);
        break;
      }
      sections.push(section);
      totalChars += section.length;
    }

    return sections.join('\n\n---\n\n');
  }
}

export function createNotionSearcher(
  db: NotionDB,
  embedder: EmbeddingModel,
  config?: Partial<{ topK: number; maxContextChars: number }>
): NotionSearcher {
  return new NotionSearcher(db, embedder, {
    topK: config?.topK ?? 5,
    maxContextChars: config?.maxContextChars ?? 2000,
  });
}
