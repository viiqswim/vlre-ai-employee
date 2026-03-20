export interface NotionConfig {
  token: string | null;           // null = Notion integration disabled
  dbPath: string;                  // default: 'data/notion-embeddings.db'
  syncIntervalHours: number;       // default: 1
  maxContextChars: number;         // default: 2000
  minChunkLength: number;          // default: 50
  topK: number;                    // default: 5
}

const parseIntOrDefault = (val: string | undefined, defaultVal: number): number => {
  const parsed = parseInt(val ?? String(defaultVal), 10);
  return Number.isNaN(parsed) ? defaultVal : parsed;
};

export function loadNotionConfig(): NotionConfig {
  const token = process.env['NOTION_TOKEN']?.trim() || null;

  if (token) {
    console.log('[NOTION] Notion integration enabled');
  } else {
    console.log('[NOTION] NOTION_TOKEN not set — Notion integration disabled');
  }

  return {
    token,
    dbPath: process.env['NOTION_DB_PATH'] ?? 'data/notion-embeddings.db',
    syncIntervalHours: parseIntOrDefault(process.env['NOTION_SYNC_INTERVAL_HOURS'], 1),
    maxContextChars: parseIntOrDefault(process.env['NOTION_MAX_CONTEXT_CHARS'], 2000),
    minChunkLength: parseIntOrDefault(process.env['NOTION_MIN_CHUNK_LENGTH'], 50),
    topK: parseIntOrDefault(process.env['NOTION_TOP_K'], 5),
  };
}
