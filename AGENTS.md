# Papi Chulo — VL Real Estate Digital Employee

A digital employee for VL Real Estate built on the OpenClaw agent runtime. Papi Chulo monitors Hostfully PMS for incoming guest messages, classifies them with Claude AI, and routes them through a Slack approval workflow where the CS team reviews and sends responses.

**Stack**: Bun, TypeScript, OpenClaw 2026.3.13, Slack Bolt, Hostfully API, Tailscale Funnel

This project uses OpenCode for AI-assisted development. `AGENTS.md` is the primary instruction file read by OpenCode and compatible tools (Codex, Cursor, Copilot, Windsurf).

## Commands

```bash
bun test                    # Run tests with bun:test
bun run typecheck           # TypeScript type checking
bun run scripts/simulate-webhook.ts  # Test pipeline with real Hostfully messages
./start.sh                  # Full startup: Tailscale Funnel + Claude proxy + service
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
