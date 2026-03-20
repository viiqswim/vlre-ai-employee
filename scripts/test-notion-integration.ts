#!/usr/bin/env bun
/**
 * E2E verification script for Notion integration.
 * Usage: NOTION_TOKEN=your_token bun run scripts/test-notion-integration.ts
 * 
 * Steps:
 * 1. Load config and verify NOTION_TOKEN is set
 * 2. Initialize all components (DB, embedder, sync, search)
 * 3. Run initial sync and verify pages are loaded
 * 4. Run a sample search and verify results
 * 5. Run sync again and verify idempotency (chunk count unchanged)
 * 6. Clean up temp DB
 * 7. Exit 0 on success, 1 on any failure
 */

import { existsSync, unlinkSync } from 'node:fs';
import { Client } from '@notionhq/client';
import { loadNotionConfig } from '../skills/notion-sync/config.js';
import { createNotionDB } from '../skills/notion-search/db.js';
import { createEmbedder } from '../skills/notion-search/embedder.js';
import { createNotionSync } from '../skills/notion-sync/notion-sync.js';
import { createNotionSearcher } from '../skills/notion-search/notion-search.js';

const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  cyan:  '\x1b[36m',
};
const green  = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const red    = (s: string) => `${c.red}${s}${c.reset}`;
const cyan   = (s: string) => `${c.cyan}${s}${c.reset}`;
const dim    = (s: string) => `${c.dim}${s}${c.reset}`;
const bold   = (s: string) => `${c.bold}${s}${c.reset}`;

const TEST_DB_PATH = '/tmp/notion-integration-test.db';
let failed = false;

function pass(msg: string): void {
  console.log(`${green('✅')} ${msg}`);
}

function fail(msg: string, error?: unknown): void {
  console.error(`${red('❌')} ${msg}`);
  if (error) console.error(`   ${dim('Error:')} ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

async function main(): Promise<void> {
  console.log(`\n${bold('🔍 Notion Integration E2E Verification')}\n`);

  // Step 1: Config check
  const config = loadNotionConfig();
  if (config.token === null) {
    fail('NOTION_TOKEN not set — set NOTION_TOKEN env var and retry');
    process.exit(1);
  }
  pass('Config loaded — NOTION_TOKEN is set');

  // Clean up any existing test DB
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  // Override DB path for test
  const testConfig = { ...config, dbPath: TEST_DB_PATH };

  let db;
  try {
    db = createNotionDB(TEST_DB_PATH);
    pass(`SQLite DB created at ${TEST_DB_PATH}`);
  } catch (err) {
    fail('Failed to create SQLite DB', err);
    process.exit(1);
  }

  let embedder;
  try {
    console.log(`${cyan('⏳')} Loading embedding model (may take 30s on first run)...`);
    embedder = await createEmbedder();
    if (!embedder.isReady()) {
      fail('Embedding model failed to initialize');
      process.exit(1);
    }
    pass('Embedding model loaded and ready');
  } catch (err) {
    fail('Failed to initialize embedding model', err);
    process.exit(1);
  }

  const notionClient = new Client({ auth: testConfig.token, notionVersion: '2026-03-11' });
  const sync = createNotionSync(notionClient, db, embedder, testConfig);
  const searcher = createNotionSearcher(db, embedder, {
    topK: testConfig.topK,
    maxContextChars: testConfig.maxContextChars,
  });

  // Step 3: Initial sync
  console.log(`\n${cyan('⏳')} Running initial sync (this may take a while for large wikis)...`);
  let syncResult1;
  try {
    syncResult1 = await sync.syncAll();
    if (syncResult1.pagesTotal === 0) {
      fail('Sync returned 0 pages — check NOTION_TOKEN has access to pages in workspace');
    } else {
      pass(`Sync complete: ${syncResult1.pagesTotal} pages found, ${syncResult1.pagesUpdated} updated, ${syncResult1.chunksTotal} chunks`);
    }
    if (syncResult1.truncatedPages.length > 0) {
      console.log(`   ${yellow('⚠️')}  ${syncResult1.truncatedPages.length} truncated page(s): ${syncResult1.truncatedPages.join(', ')}`);
    }
    if (syncResult1.errors.length > 0) {
      console.log(`   ${yellow('⚠️')}  ${syncResult1.errors.length} error(s) during sync:`);
      syncResult1.errors.forEach(e => console.log(`      - ${e.pageId}: ${e.error}`));
    }
    console.log(`   ${dim(`Duration: ${syncResult1.durationMs}ms`)}`);
  } catch (err) {
    fail('Sync threw an error', err);
  }

  // Step 4: Search
  if (!failed && syncResult1 && syncResult1.chunksTotal > 0) {
    try {
      const results = await searcher.search('check-in information wifi password house rules');
      if (results.length === 0) {
        fail('Search returned 0 results (expected at least 1 with chunks in DB)');
      } else {
        pass(`Search returned ${results.length} results`);
        console.log('   Top result:');
        console.log(`     ${dim('Page:')} ${results[0]?.pageTitle ?? 'unknown'}`);
        console.log(`     ${dim('Heading:')} ${results[0]?.heading ?? '(none)'}`);
        console.log(`     ${dim('Score:')} ${(results[0]?.score ?? 0).toFixed(4)}`);
        const ctx = searcher.formatAsContext(results);
        console.log(`     ${dim(`Context length: ${ctx.length} chars (max: ${testConfig.maxContextChars})`)}`);
        if (ctx.length > testConfig.maxContextChars + 100) {
          fail(`Context exceeds maxContextChars (${ctx.length} > ${testConfig.maxContextChars})`);
        } else {
          pass(`Context within character limit`);
        }
      }
    } catch (err) {
      fail('Search threw an error', err);
    }
  }

  // Step 5: Idempotency check
  if (!failed) {
    try {
      const chunkCountBefore = db.getChunkCount();
      console.log(`\n${cyan('⏳')} Running sync again (idempotency check)...`);
      const syncResult2 = await sync.syncAll();
      const chunkCountAfter = db.getChunkCount();
      
      if (chunkCountBefore !== chunkCountAfter) {
        fail(`Sync is NOT idempotent: chunk count changed ${chunkCountBefore} → ${chunkCountAfter}`);
      } else {
        pass(`Sync is idempotent: ${chunkCountAfter} chunks (unchanged)`);
      }
      console.log(`   ${dim(`Pages skipped (unchanged): ${syncResult2.pagesSkipped}`)}`);
      console.log(`   ${dim(`Pages updated: ${syncResult2.pagesUpdated}`)}`);
    } catch (err) {
      fail('Second sync threw an error', err);
    }
  }

  // Cleanup
  try {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
      pass('Test DB cleaned up');
    }
  } catch (err) {
    console.warn(`${yellow('⚠️')}  Failed to clean up test DB:`, err);
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  if (failed) {
    console.error(`${red('❌')} E2E verification FAILED — see errors above`);
    process.exit(1);
  } else {
    console.log(`${green('✅')} All E2E checks PASSED`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`\n💥 Unhandled error:`, err);
  process.exit(1);
});
