# Notion Wiki Integration

> This document covers the Notion wiki integration in Papi Chulo — a local embedding cache that makes the company's Notion workspace searchable by both the guest response pipeline and the KB Assistant. For the core guest messaging pipeline, see `2026-03-18-1312-architecture.md`. For the KB Assistant, see `2026-03-19-1202-kb-assistant.md`.

How Notion pages are synced, embedded, and searched. Each section has numbered steps with explanations below it.

<!-- Mermaid Color Palette (matches architecture.md)
classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff
classDef external fill:#F5A623,stroke:#C4841A,color:#fff
classDef decision fill:#F8E71C,stroke:#C7B916,color:#333
classDef event fill:#50C878,stroke:#2D7A4A,color:#fff
classDef error fill:#E74C3C,stroke:#A93226,color:#fff
classDef future fill:#B0B0B0,stroke:#808080,color:#333,stroke-dasharray: 5 5

Legend: blue=service, purple=storage, orange=external, yellow=decision, green=event, red=error, gray-dashed=future
-->

---

## 1. System Context

Where Notion fits in the overall Papi Chulo architecture — a second knowledge source that runs alongside the existing markdown KB files and feeds context into both the guest response pipeline and the KB Assistant.

```mermaid
graph LR
    subgraph Sources["Knowledge Sources"]
        MKBF[("knowledge-base/\nmarkdown files")]
        NDB[("data/notion-embeddings.db\nSQLite cache")]
    end

    subgraph Sync["Background Sync"]
        NAPI[Notion API]
        NS[NotionSync]
        NAPI -->|"hourly fetch"| NS
        NS -->|"store pages + chunks"| NDB
    end

    subgraph Consumers["Consumers"]
        PL[Pipeline\nguest responses]
        KBA[KB Assistant\nCS team queries]
    end

    NSCH[NotionSearcher] -->|"cosine similarity"| NDB
    MKBF --> PL
    MKBF --> KBA
    NSCH --> PL
    NSCH --> KBA

    classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
    classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff
    classDef external fill:#F5A623,stroke:#C4841A,color:#fff
    classDef event fill:#50C878,stroke:#2D7A4A,color:#fff

    class NS,NSCH service
    class MKBF,NDB storage
    class NAPI external
    class PL,KBA event
```

| # | What happens |
|---|---|
| 1 | `NotionSync` runs as a background job, fetching pages from the Notion API and storing them locally |
| 2 | Pages are chunked by heading and embedded into 384-dimensional vectors, then stored in SQLite alongside the raw markdown |
| 3 | `NotionSearcher` answers queries by embedding the query text and computing cosine similarity against all stored chunk vectors |
| 4 | The guest response pipeline calls `NotionSearcher` after the markdown KB search — Notion context is appended under a separator before the Claude call |
| 5 | The KB Assistant calls `NotionSearcher` the same way, enriching answers to CS team @mention questions |
| 6 | If `NOTION_TOKEN` is not set, the integration is disabled entirely — both consumers receive an empty string and continue normally |

---

## 2. Sync Flow

How pages are fetched from Notion and stored locally — a background job that runs hourly and on startup.

```mermaid
sequenceDiagram
    autonumber
    participant CR as Croner
    participant NS as NotionSync
    participant NA as Notion API
    participant CK as Chunker
    participant EM as Embedder
    participant DB as SQLite DB

    CR->>NS: syncAll() — on startup + every hour
    NS->>NA: POST /v1/search (paginated, 350ms between calls)
    NA-->>NS: page list with last_edited_time
    NS->>DB: check last_edited per page_id
    DB-->>NS: stored last_edited timestamps
    NS->>NA: GET /v1/pages/{id}/markdown (changed pages only)
    NA-->>NS: markdown string (truncated: true → log warning)
    NS->>CK: chunkMarkdown(markdown)
    CK-->>NS: chunks split by ## / ### headers, min 50 chars
    NS->>EM: embedBatch(chunks) — all-MiniLM-L6-v2
    EM-->>NS: Float32Array[] — 384 dims per chunk
    NS->>DB: upsert pages table + chunks table (BLOB embeddings)
    NS->>DB: deleteOrphanedPages()
    Note over NS: Log: pages updated, skipped, chunks total, orphans removed
```

| # | What happens |
|---|---|
| 1 | `croner` fires `syncAll()` immediately on startup, then on the configured interval (default: every hour) |
| 2 | `notion.search()` is called with pagination — the Notion API `POST /v1/search` endpoint returns page titles and metadata. Rate limit is 3 req/sec; a 350ms delay is inserted between page fetches |
| 3 | Each page's `last_edited_time` is compared against the value stored in SQLite. Pages with no change are skipped entirely |
| 4 | For changed pages, `GET /v1/pages/{id}/markdown` (Notion API 2026-03-11) fetches the full page as a markdown string. If the response includes `truncated: true`, a `[NOTION]` warning is logged |
| 5 | `chunkMarkdown()` splits the markdown on `##` and `###` headers. Chunks shorter than `NOTION_MIN_CHUNK_LENGTH` (default: 50 chars) are filtered out |
| 6 | `embedder.embedBatch()` runs all chunks through `Xenova/all-MiniLM-L6-v2` (cached in `~/.cache/huggingface/hub/`). Each chunk produces a 384-dimensional `Float32Array` |
| 7 | Chunks and their embeddings are upserted into SQLite. The unique constraint on `(page_id, heading, content)` makes re-syncs idempotent |
| 8 | `deleteOrphanedPages()` removes any `pages` rows whose `page_id` no longer appears in the Notion workspace. Cascading deletes clean up the associated `chunks` rows automatically |

---

## 3. Search Flow

How a query gets answered from the Notion wiki — runs on every incoming guest message and every KB Assistant @mention.

```mermaid
flowchart TD
    subgraph Input["Input"]
        Q([Query text\nguest message or CS question])
    end

    subgraph Embed["Embed Query"]
        Q --> EMB[embedder.embed\nall-MiniLM-L6-v2]
        EMB --> VEC["384-dim Float32Array"]
    end

    subgraph Retrieve["Retrieve Candidates"]
        VEC --> LOAD[getAllChunkEmbeddings\nfrom SQLite]
        LOAD --> EMPTY{DB empty?}
        EMPTY -->|yes| NONE([Return empty string])
        EMPTY -->|no| COS[Cosine similarity\nagainst all vectors]
        COS --> TOP[Top-5 results\nsorted by score]
    end

    subgraph Format["Format Context"]
        TOP --> FMT[formatAsContext\nmarkdown sections]
        FMT --> CAP{Over 2000 chars?}
        CAP -->|yes| TRUNC[Truncate to 2000 chars]
        CAP -->|no| RET([Return context string])
        TRUNC --> RET
    end

    classDef event fill:#50C878,stroke:#2D7A4A,color:#fff
    classDef decision fill:#F8E71C,stroke:#C7B916,color:#333
    classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
    classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff

    class Q,NONE,RET event
    class EMPTY,CAP decision
    class EMB,LOAD,COS,TOP,FMT,TRUNC service
    class VEC storage
```

| # | What happens |
|---|---|
| 1 | `NotionSearcher.search(query)` is called with the raw query text |
| 2 | The query is embedded using the same `Xenova/all-MiniLM-L6-v2` model used during sync — this ensures the query vector lives in the same space as the stored chunk vectors |
| 3 | `getAllChunkEmbeddings()` loads all chunk rows from SQLite. If the table is empty (no sync has run yet, or Notion is not configured), an empty string is returned immediately |
| 4 | Cosine similarity is computed between the query vector and every stored chunk vector. This is brute-force — fast and correct for fewer than 2,000 vectors |
| 5 | The top `NOTION_TOP_K` results (default: 5) are returned, sorted by descending similarity score |
| 6 | `formatAsContext()` formats each result as a markdown section with the page title and chunk heading as a header, followed by the chunk content |
| 7 | The combined context string is capped at `NOTION_MAX_CONTEXT_CHARS` (default: 2,000 chars). If it exceeds the cap, it's truncated with a trailing `…` |

---

## 4. Guest Response Pipeline Integration

How Notion wiki context is injected into guest response drafts — appended after the markdown KB context, before the Claude call. For the full pipeline flow, see `2026-03-18-1312-architecture.md` Section 4.

```mermaid
graph LR
    subgraph KBBlock["KB Context"]
        KBS[kbReader.search\ncommon.md + property KB]
        KBC[("KB context string")]
        KBS --> KBC
    end

    subgraph NotionBlock["Notion Enrichment"]
        NTN[notionSearch.search\nNotionSearcher]
        NTC[("Notion context string")]
        ERR{Search failed?}
        NTN --> ERR
        ERR -->|yes| SKIP([Continue with KB only])
        ERR -->|no| NTC
    end

    subgraph ClaudeBlock["Claude Call"]
        MERGE["Merge: KB context\n## Additional Context\nNotion context"]
        CL[Claude AI\nclassify + draft]
        MERGE --> CL
    end

    KBC --> MERGE
    NTC --> MERGE

    classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
    classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff
    classDef decision fill:#F8E71C,stroke:#C7B916,color:#333
    classDef event fill:#50C878,stroke:#2D7A4A,color:#fff
    classDef external fill:#F5A623,stroke:#C4841A,color:#fff

    class KBS,NTN,MERGE service
    class KBC,NTC storage
    class ERR decision
    class SKIP event
    class CL external
```

| # | What happens |
|---|---|
| 1 | `kbReader.search()` runs first, returning relevant sections from `common.md` and the property-specific KB file |
| 2 | `PipelineContext` exposes a `get notionSearch()` getter that reads the live `notionSearch` value at call time. This is safe even if the embedding model is still loading when the pipeline starts — the getter always reflects the current state |
| 3 | `notionSearch.search(guestMessage)` is called with the raw guest message text |
| 4 | If the Notion search throws (DB not initialized, model not loaded), the error is caught and logged. The pipeline continues with KB-only context — Notion is never a hard dependency |
| 5 | If Notion returns a non-empty context string, it is appended to the KB context under a `## Additional Context (Company Wiki)` separator |
| 6 | The merged context string is passed to Claude alongside the guest message, conversation history, and guest details |

---

## 5. KB Assistant Integration

How Notion wiki context enriches answers to CS team @mention questions. For the full KB Assistant flow, see `2026-03-19-1202-kb-assistant.md`.

```mermaid
graph LR
    subgraph Registration["Handler Registration"]
        IDX[src/index.ts] -->|"passes proxy at startup"| REG[registerKBAssistantHandlers]
        PROXY["notionSearchProxy\nclosure over notionSearch var"]
        REG --> PROXY
    end

    subgraph Query["Question Flow"]
        MENTION([app_mention event]) --> KBS2[kbReader.search\ncommon + property KB]
        KBS2 --> NTN2[notionSearchProxy.search\ndelegates to current notionSearch]
        NTN2 --> MERGE2["Merge KB + Notion context"]
        MERGE2 --> CL2[Claude AI\nanswer question]
        CL2 --> RESP([Post answer in thread])
    end

    classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
    classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff
    classDef event fill:#50C878,stroke:#2D7A4A,color:#fff
    classDef external fill:#F5A623,stroke:#C4841A,color:#fff

    class IDX,REG,KBS2,NTN2,MERGE2 service
    class PROXY storage
    class MENTION,RESP event
    class CL2 external
```

| # | What happens |
|---|---|
| 1 | At startup, `src/index.ts` creates a `notionSearchProxy` object — a plain object whose `.search()` method delegates to the current value of the `notionSearch` variable via closure |
| 2 | The proxy is passed to `registerKBAssistantHandlers()` at registration time. Because it's a proxy (not the `NotionSearcher` instance directly), the handler always calls whatever `notionSearch` points to when the question arrives |
| 3 | This matters because the `Xenova/all-MiniLM-L6-v2` model loads asynchronously. If a question arrives before the model finishes loading, the proxy safely delegates to the not-yet-ready instance, which returns an empty string rather than throwing |
| 4 | On an @mention, `kbReader.search()` runs first (same as the guest pipeline), then `notionSearchProxy.search()` is called with the stripped question text |
| 5 | If Notion returns context, it is appended under `## Additional Context (Company Wiki)` before the Claude call — identical to the guest pipeline pattern |
| 6 | Claude receives the combined context and answers the question. The KB Assistant's answer format (`{ found, answer, source }`) is unchanged — Notion context is invisible to the response format |

---

## 6. Data Model

What is stored in SQLite and how the two tables relate — a local embedding cache that makes Notion searchable without hitting the API on every query.

```mermaid
graph TD
    subgraph DB["data/notion-embeddings.db — WAL mode"]
        PG[("pages\npage_id PK\ntitle\nmarkdown\nlast_edited ISO timestamp\nsynced_at Unix ms")]
        CK[("chunks\nid auto PK\npage_id FK\nheading nullable\ncontent text\nembedding BLOB\n384 x float32 = 1536 bytes")]
        PG -->|"CASCADE DELETE"| CK
    end

    subgraph Constraints["Constraints"]
        UQ["UNIQUE page_id + heading + content\nidempotent re-sync"]
        WAL["WAL mode\nconcurrent read + write safe"]
    end

    classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff

    class PG,CK,UQ,WAL storage
```

| Detail | Explanation |
|---|---|
| **`pages` table** | One row per Notion page. `page_id` is the Notion page UUID. `markdown` stores the full page content as returned by the API. `last_edited` is the ISO timestamp from Notion — used to skip unchanged pages on re-sync. `synced_at` is the Unix millisecond timestamp of the last successful sync |
| **`chunks` table** | One row per indexed section. `page_id` is a foreign key to `pages` with `ON DELETE CASCADE` — deleting a page removes all its chunks automatically. `heading` is the `##` or `###` header text (nullable for content before the first heading). `embedding` is stored as a raw BLOB: 384 `float32` values = 1,536 bytes per chunk |
| **Unique constraint** | `UNIQUE(page_id, heading, content)` ensures that re-syncing the same page is idempotent — duplicate chunks are ignored via `INSERT OR IGNORE` |
| **WAL mode** | Write-Ahead Logging is enabled on startup. This allows the hourly sync (writer) and per-message search (reader) to run concurrently without blocking each other |
| **Default path** | `data/notion-embeddings.db`. Override with `NOTION_DB_PATH`. The `data/` directory is gitignored — the file is created automatically on first sync |

---

## Environment Variables

All Notion integration settings are optional. The integration is disabled entirely if `NOTION_TOKEN` is not set — no errors, no warnings, just empty context strings passed to Claude.

| Variable | Default | Description |
|---|---|---|
| `NOTION_TOKEN` | — | **Required to enable.** Internal integration secret from notion.so/profile/integrations |
| `NOTION_DB_PATH` | `data/notion-embeddings.db` | Path for the local SQLite embedding cache |
| `NOTION_SYNC_INTERVAL_HOURS` | `1` | How often to re-sync from Notion |
| `NOTION_MAX_CONTEXT_CHARS` | `2000` | Hard cap on Notion context injected into Claude |
| `NOTION_TOP_K` | `5` | Number of most-relevant wiki chunks to retrieve per query |
| `NOTION_MIN_CHUNK_LENGTH` | `50` | Minimum chars for a section to be indexed |
