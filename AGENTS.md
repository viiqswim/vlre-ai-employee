# Papi Chulo — VL Real Estate Digital Employee

A digital employee for VL Real Estate built on the OpenClaw agent runtime. Papi Chulo monitors Hostfully PMS for incoming guest messages, classifies them with Claude AI, and routes them through a Slack approval workflow where the CS team reviews and sends responses.

**Stack**: Bun, TypeScript, OpenClaw 2026.3.13, Slack Bolt, Hostfully API, Tailscale Funnel

This project uses OpenCode for AI-assisted development. `AGENTS.md` is the primary instruction file read by OpenCode and compatible tools (Codex, Cursor, Copilot, Windsurf).

## Commands

```bash
bun test                    # Run tests with bun:test
bun run typecheck           # TypeScript type checking (src/ and skills/ only — not scripts/)
bun run scripts/simulate-webhook.ts  # Test pipeline with real Hostfully messages
bun run start               # Full startup: OpenClaw check → Tailscale Funnel → Claude proxy (if proxy mode) → service
```

## Project Structure

```
src/                Main service (index.ts entry, webhook-receiver.ts, index.test.ts)
skills/             8 OpenClaw skills (pipeline, hostfully-client, kb-reader, slack-bot, slack-blocks, dedup, thread-tracker, audit-logger)
scripts/            Utilities (register-webhook.ts, simulate-webhook.ts, deregister-webhook.ts, convert-xlsx-to-kb.ts, common-kb-builder.ts)
docs/               Architecture and security documentation
data/               Runtime persistence (dedup store, thread tracker)
logs/               JSONL audit logs (append-only)
knowledge-base/     Multi-property knowledge base (see Knowledge Base System section below)
knowledge-base.md   Legacy single-file KB — superseded by knowledge-base/ directory, kept for reference
SOUL.md             OpenClaw agent persona (read-only)
```

## Bun Development

Default to Bun instead of Node.js, npm, or vite:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run <script>`
- `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads `.env` — don't use dotenv

**APIs**: Use `Bun.serve()` for routes/WebSockets (not express), `bun:sqlite` for SQLite, `Bun.file` for file I/O, `Bun.$` for shell commands.

**Testing**: Use `bun:test` with `import { test, expect } from "bun:test"`.

## Conventions

- **TypeScript strict mode**: `strict: true`, `noUncheckedIndexedAccess: true`
- **ESM modules**: `"type": "module"` in package.json
- **OpenClaw skill pattern**: each skill has `index.ts` + implementation file
- **Docs naming**: `YYYY-MM-DD-HHMM-name.md` (timestamped, sortable)
- **Shell scripts use zx**: All shell-type scripts use [Google zx](https://github.com/google/zx) with TypeScript — no plain bash. Shebang: `#!/usr/bin/env zx`. Run with `zx script-name.ts` or add to `package.json` scripts.

## Mermaid Diagram Guidelines

Use these rules whenever creating or modifying Mermaid diagrams in this project.

### Diagram Type Selection

| What to show | Use this | Avoid |
|---|---|---|
| System overview or external context | `graph LR` with subgraphs | sequence |
| Module creation / wiring | `graph LR` with subgraphs | flat `graph TD` |
| Runtime call dependencies | `graph LR` with subgraphs | flat graph without grouping |
| Temporal ordering / who-calls-whom | `sequenceDiagram` | flowchart |
| Decision logic / branching process | `flowchart TD` with `{diamond}` nodes | sequence |
| Persistence mechanism lifecycle | `flowchart TD` with subgraphs | ER diagram |
| State machine / entity lifecycle | `stateDiagram-v2` | flowchart |
| Data model / database schema | `erDiagram` | flowchart |
| Input → process → output mapping | `flowchart LR` with subgraphs | sequence |

### Readability Rules

- **Max 20 nodes per diagram.** If you have more, split into multiple diagrams.
- **Group by responsibility, not technology.** Subgraph labels describe what things DO, not what they ARE.
- **Direction**: `LR` for pipelines and data flows; `TD` for hierarchies and processes.
- **Node shapes carry meaning**: `["text"]` = service/process, `(["text"])` = event/trigger, `{"text"}` = decision, `[("text")]` = database/storage.
- **Edge styles carry meaning**: `-->` = synchronous call, `-.->` = async or optional, `==>` = critical path.
- **Keep labels short**: node labels ≤ 3 words + optional subtitle; edge labels ≤ 5 words.
- **No HTML tags** in labels (`<br/>`, `<i>`, `<b>` break multi-renderer compatibility). Use plain text.
- **No `end` as a node label** — it is a reserved Mermaid keyword and breaks parsing.
- **No subgraph-to-subgraph edges** — always connect specific node IDs.

### Standard Color Palette

Include these classDef lines in every flowchart/graph diagram and assign all nodes a class:

```
classDef service fill:#4A90E2,stroke:#2E5C8A,color:#fff
classDef storage fill:#7B68EE,stroke:#5B4BC7,color:#fff
classDef external fill:#F5A623,stroke:#C4841A,color:#fff
classDef decision fill:#F8E71C,stroke:#C7B916,color:#333
classDef event fill:#50C878,stroke:#2D7A4A,color:#fff
classDef error fill:#E74C3C,stroke:#A93226,color:#fff
classDef future fill:#B0B0B0,stroke:#808080,color:#333,stroke-dasharray: 5 5
```

**Class semantics**: `service` = blue (services, APIs, modules), `storage` = purple (files, databases, queues), `external` = orange (third-party systems), `decision` = yellow (conditionals), `event` = green (triggers, start/end points), `error` = red (failure states), `future` = gray dashed (planned, not yet built).

**Sequence diagrams** (`sequenceDiagram`) do not support `classDef` — omit the palette block for those.

### Anti-Patterns

- **No flat graphs with 10+ nodes** — add subgraphs or split the diagram.
- **No shared convergence nodes across paths** — duplicate endpoint nodes (e.g. audit log) per path to avoid crossing edges.
- **No mixing current and future state** — apply `future` classDef to planned nodes; do not hide them in the current architecture.
- **No mixing abstraction levels** — one diagram answers one question (creation wiring OR runtime deps, not both).
- **No single diagram trying to show everything** — split by concern (e.g. dedup and thread tracking are separate diagrams).

### Diagram Sizing Guide

| Node count | Action |
|---|---|
| 5–10 | No grouping needed |
| 10–15 | Add subgraphs |
| 15–20 | Must have subgraphs; consider splitting |
| 20+ | Must split into multiple diagrams |

### Validation

After writing or editing a diagram, validate with:
```bash
bunx mmdc -i <file.md> -o /tmp/test.svg 2>&1
# Expected: zero errors, exit code 0
```

## Knowledge Base System

The pipeline uses a hierarchical multi-property knowledge base. `MultiPropertyKBReader` (in `skills/kb-reader/`) loads two files per guest message:

1. **`knowledge-base/common.md`** — Always loaded. Contains shared policies, 16 common guest Q&A scenarios, a property quick-reference table, and a service provider directory for maintenance escalation.
2. **`knowledge-base/properties/{code}.md`** — Loaded based on the guest's property. One file per property group (16 total), each containing WiFi, amenities, house rules, fees, and per-unit details for multi-room properties.

**Routing**: The pipeline reads the incoming message's `propertyName` from Hostfully and looks it up in `knowledge-base/property-map.json` (16 entries, supports partial matching). If no match is found it falls back to `common.md` only and logs a `[KB]` warning.

**Property codes and their KB files:**
| Code | Address | KB File |
|---|---|---|
| 7213-NUT | 7213 Nutria Run, Austin TX | `properties/7213-nut.md` |
| 3412-SAN | 3412 Sand Dunes Ave, Austin TX | `properties/3412-san.md` |
| 3420-HOV | 3420 Hovenweep Ave, Austin TX | `properties/3420-hov.md` |
| 3401-BRE | 3401 Breckenridge Dr, Austin TX | `properties/3401-bre.md` |
| 271-GIN | 271 Gina Dr, Kyle TX | `properties/271-gin.md` |
| 3505-BAN | 3505 Banton Rd, Austin TX | `properties/3505-ban.md` |
| 407-GEV | 407 S Gevers St, San Antonio TX | `properties/407-gev.md` |
| 219-PAU | 219 Paul St, San Antonio TX | `properties/219-pau.md` |
| 4403-HAY | 4403 Hayride Ln, Austin TX | `properties/4403-hay.md` |
| 4405-HAY | 4405 Hayride Ln, Austin TX | `properties/4405-hay.md` |
| 4410-HAY | 4410 Hayride Ln, Austin TX | `properties/4410-hay.md` |
| 5306-KIN | 5306 King Charles Dr, Austin TX | `properties/5306-kin.md` |
| 6002-PAL | 6002 Palm Cir, Austin TX | `properties/6002-pal.md` |
| 6930-HER | 6930 Heron Flats, Converse TX | `properties/6930-her.md` |
| 8039-CHE | 8039 Chestnut Cedar Dr, Converse TX | `properties/8039-che.md` |
| 1602-BLU | 1602 Bluebird Dr, Bailey CO | `properties/1602-blu.md` |

**Regenerating the KB** (run whenever source XLSX files change):
```bash
bun run scripts/convert-xlsx-to-kb.ts --source /Users/victordozal/Downloads/properties-info/
```

**Important**: `knowledge-base/common.md` has manual content improvements applied on top of what the script generates (improved Late Check-out response, English-only Q&A). Re-running the script will overwrite these. Either re-apply the fixes manually after regeneration, or update `scripts/common-kb-builder.ts` to apply them programmatically.

**Source files**: `/Users/victordozal/Downloads/properties-info/` — 41 XLSX property templates + `common-situations.xlsx`

**Discrepancies found during initial conversion** (see `knowledge-base/discrepancy-report.md`):
- `271-GIN` — No HOME file exists; KB built from room files only
- `1602-BLU` — Source XLSX has a different format (3 sheets instead of 7); KB is partial

## Do Not Modify

- `SOUL.md` — OpenClaw agent persona (tone/style updates permitted; security/classification sections are read-only)
- `knowledge-base.md` — Legacy single-file KB, now superseded. Do not write to it from new code.
- `.env` — Local secrets, never commit
- `data/` — Runtime persistence (managed by app)
- `logs/` — Audit logs (append-only, managed by app)

## Deeper Docs

- `docs/2026-03-18-1312-architecture.md` — Full architecture with 9 mermaid diagrams
- `docs/security.md` — OpenClaw gateway security hardening
- `SOUL.md` — OpenClaw agent persona and behavior
- `README.md` — User-facing setup and operations guide
