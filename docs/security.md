# Security Hardening

OpenClaw gateway security configuration for Papi Chulo.

## Applied Hardening

| Control | Status | Detail |
|---------|--------|--------|
| Gateway bind address | ✅ loopback only | `bind: "loopback"` — `127.0.0.1:18789` only, never `0.0.0.0` |
| Gateway auth token | ✅ configured | `gateway.auth.mode: "token"` with random token in config |
| Webhook hooks.token | ✅ configured | 64-char hex in `~/.openclaw/openclaw.json` + `.env` |
| exec.approvals | ⚠️ N/A | Not a config key in OpenClaw 2026.3.13 — agent has no shell exec tools registered |
| ClawHub auto-discovery | ⚠️ N/A | `plugins.clawhub` not a valid key — enforced by not installing any ClawHub skills |
| Tailscale Funnel on port 18789 | ✅ disabled | `tailscale.mode: "off"` in gateway config |
| Community skills | ✅ none installed | All skills are custom-written |

## Verification Commands

```bash
# Gateway is loopback-only
lsof -i :18789 | grep LISTEN
# → must show 127.0.0.1:18789, NOT *:18789

# Webhook auth works
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:18789/hooks/test
# → 401 (no token)

curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:18789/hooks/test \
  -H "Authorization: Bearer $OPENCLAW_HOOKS_TOKEN"
# → non-401

# Gateway is healthy
curl -s http://127.0.0.1:18789/health
# → {"ok":true,"status":"live"}
```

## Security Notes

- `OPENCLAW_HOOKS_TOKEN` is in `.env` — never commit this file
- The gateway auth token is stored in `~/.openclaw/openclaw.json` — this file is not in the repo
- Never expose port 18789 via Tailscale Funnel — only the webhook receiver (port 3001) is public
- Only install skills from `skills/` in this repo — never from ClawHub
- The agent persona (SOUL.md) includes prompt injection defense

## CVEs Tracked (March 2026)

OpenClaw 2026.3.13 is the pinned version. Monitor:
- https://github.com/openclaw/openclaw/security/advisories

Before upgrading: review all new CVEs and test in dev first.
