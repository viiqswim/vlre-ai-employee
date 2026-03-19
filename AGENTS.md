# Papi Chulo — VL Real Estate Digital Employee

A digital employee for VL Real Estate built on the OpenClaw agent runtime. Papi Chulo monitors Hostfully PMS for incoming guest messages, classifies them with Claude AI, and routes them through a Slack approval workflow where the CS team reviews and sends responses.

**Stack**: Bun, TypeScript, OpenClaw 2026.3.13, Slack Bolt, Hostfully API, Tailscale Funnel

This project uses OpenCode for AI-assisted development. `AGENTS.md` is the primary instruction file read by OpenCode and compatible tools (Codex, Cursor, Copilot, Windsurf).

## Commands

```bash
bun test                    # Run tests with bun:test
bun run typecheck           # TypeScript type checking
bun run scripts/simulate-webhook.ts  # Test pipeline with real Hostfully messages
bun run start               # Full startup: Tailscale Funnel + Claude proxy + service
```

## Project Structure

```
src/                Main service (index.ts entry, webhook-receiver.ts, index.test.ts)
skills/             8 OpenClaw skills (pipeline, hostfully-client, kb-reader, slack-bot, slack-blocks, dedup, thread-tracker, audit-logger)
scripts/            Utilities (register-webhook.ts, simulate-webhook.ts, deregister-webhook.ts)
docs/               Architecture and security documentation
data/               Runtime persistence (dedup store, thread tracker)
logs/               JSONL audit logs (append-only)
knowledge-base.md   Property info, policies, response templates (edit directly)
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

## Do Not Modify

- `SOUL.md` — OpenClaw agent persona (read-only)
- `knowledge-base.md` — Edit carefully; it's operational data
- `.env` — Local secrets, never commit
- `data/` — Runtime persistence (managed by app)
- `logs/` — Audit logs (append-only, managed by app)

## Deeper Docs

- `docs/2026-03-18-1312-architecture.md` — Full architecture with 9 mermaid diagrams
- `docs/security.md` — OpenClaw gateway security hardening
- `SOUL.md` — OpenClaw agent persona and behavior
- `README.md` — User-facing setup and operations guide
