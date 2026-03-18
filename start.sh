#!/bin/bash
# Papi Chulo — VL Real Estate Digital Employee
# Start script: launches the webhook server + Slack bot

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BOT_NAME="${BOT_NAME:-Papi Chulo}"
WEBHOOK_PORT="${WEBHOOK_PORT:-$(grep '^WEBHOOK_PORT=' .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")}"
WEBHOOK_PORT="${WEBHOOK_PORT:-3001}"

echo "Starting $BOT_NAME..."

# Check .env exists
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Copy .env.example and fill in your values."
  exit 1
fi

# Verify OpenClaw gateway is running (it's a daemon, should already be up)
if ! curl -sf http://127.0.0.1:18789/health &>/dev/null; then
  echo "⚠️  WARNING: OpenClaw gateway not running. Start with: openclaw gateway start"
fi

# Start Tailscale Funnel in persistent background mode
if command -v tailscale &> /dev/null; then
  echo "Starting Tailscale Funnel on port $WEBHOOK_PORT..."
  FUNNEL_OUTPUT=$(tailscale funnel --bg "$WEBHOOK_PORT" 2>&1)
  FUNNEL_EXIT=$?

  if [ $FUNNEL_EXIT -ne 0 ]; then
    echo ""
    echo "⚠️  WARNING: Tailscale Funnel failed to start!"
    echo "   Reason: $FUNNEL_OUTPUT"
    echo "   Hostfully webhooks will NOT reach $BOT_NAME."
    echo "   To fix: visit https://login.tailscale.com and enable Funnel,"
    echo "   then run: tailscale funnel --bg $WEBHOOK_PORT"
    echo ""
  else
    # Extract public URL from funnel status
    FUNNEL_URL=$(tailscale funnel status 2>/dev/null | grep -o 'https://[^ ]*' | head -1 | sed 's|/$||')
    if [ -n "$FUNNEL_URL" ]; then
      export WEBHOOK_PUBLIC_URL="$FUNNEL_URL"
      echo "Funnel running: $FUNNEL_URL"

      echo "✅ Funnel active — $FUNNEL_URL → localhost:$WEBHOOK_PORT"
    else
      echo "Funnel started (could not determine public URL)"
    fi
  fi
fi

# Start claude-max-api proxy in background (if CLAUDE_MODE=proxy)
if grep -q 'CLAUDE_MODE="proxy"' .env 2>/dev/null; then
  echo "Starting Claude Max API proxy..."
  # claude-max-api is installed under nodejs 20.19.0 — must specify version explicitly
  # because this project's .tool-versions uses nodejs 22.21.1 (required for OpenClaw)
  ASDF_NODEJS_VERSION=20.19.0 claude-max-api &>/tmp/riley-claude-proxy.log &
  PROXY_PID=$!
  echo "Claude proxy PID: $PROXY_PID"

  # Wait for proxy to be ready (up to 15s) using /dev/tcp bash built-in
  # Do NOT use nc (not always available on macOS) or curl (no HTTP health endpoint)
  PROXY_HOST="127.0.0.1"
  PROXY_PORT="3456"
  PROXY_TIMEOUT=15
  PROXY_ELAPSED=0
  echo "Waiting for Claude proxy on :${PROXY_PORT}..."
  while [ $PROXY_ELAPSED -lt $PROXY_TIMEOUT ]; do
    if timeout 1 bash -c "echo >/dev/tcp/${PROXY_HOST}/${PROXY_PORT}" 2>/dev/null; then
      echo "Claude proxy ready on :${PROXY_PORT} (${PROXY_ELAPSED}s)"
      break
    fi
    sleep 0.5
    PROXY_ELAPSED=$((PROXY_ELAPSED + 1))
  done

  if [ $PROXY_ELAPSED -ge $PROXY_TIMEOUT ]; then
    echo "ERROR: Claude proxy did not start within ${PROXY_TIMEOUT}s" >&2
    echo "Check logs: cat /tmp/riley-claude-proxy.log" >&2
    exit 1
  fi
fi

# Cleanup on exit
cleanup() {
  echo "Stopping $BOT_NAME..."
  [ -n "$FUNNEL_PID" ] && kill "$FUNNEL_PID" 2>/dev/null || true
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Start Papi Chulo
echo "Starting $BOT_NAME main process..."
bun run src/index.ts
