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
  claude-max-api &>/tmp/riley-claude-proxy.log &
  PROXY_PID=$!
  sleep 3
  echo "Claude proxy PID: $PROXY_PID"
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
