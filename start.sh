#!/bin/bash
# Start restaurant-chat + Cloudflare tunnel
# Usage:
#   ./start.sh                              → default (remote Ollama llama3.1:8b)
#   ./start.sh --local                      → use local Ollama instead of remote
#   ./start.sh --local llama3.2:3b          → local Ollama with custom model
#   ./start.sh llama3.2:3b                  → override model (auto-detect provider)
#   ./start.sh claude-sonnet-4-20250514              → auto-picks Anthropic
#   ./start.sh gpt-4o openai                → explicit provider
cd "$(dirname "$0")"

# Load secrets from .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Parse --local flag
USE_LOCAL=false
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--local" ]; then
    USE_LOCAL=true
  else
    ARGS+=("$arg")
  fi
done

# Allow model + provider override via CLI args
if [ -n "${ARGS[0]}" ]; then
  export LLM_MODEL="${ARGS[0]}"
fi
if [ -n "${ARGS[1]}" ]; then
  export LLM_PROVIDER="${ARGS[1]}"
fi

if [ "$USE_LOCAL" = true ]; then
  export OLLAMA_BASE_URL="http://localhost:11434/v1"
  # Ensure local Ollama is running
  if ! pgrep -q ollama; then
    echo "Starting local Ollama..."
    OLLAMA_KEEP_ALIVE=-1 ollama serve >> /tmp/ollama-local.log 2>&1 &
    sleep 3
  fi
  # Pull model if not available locally
  if ! ollama list 2>/dev/null | grep -q "^${LLM_MODEL}"; then
    echo "Pulling model ${LLM_MODEL}..."
    ollama pull "${LLM_MODEL}"
  fi
  # Preload model into memory (keep_alive=-1 means never unload)
  echo "Preloading ${LLM_MODEL} into memory..."
  curl -s http://localhost:11434/api/generate -d "{\"model\":\"${LLM_MODEL}\",\"keep_alive\":-1}" > /dev/null
else
  export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.0.30:11434/v1}"
fi
export LLM_MODEL="${LLM_MODEL:-llama3.1:8b}"
export RESTAURANT="${RESTAURANT:-delhi-darbar}"

DISPLAY_NAME="${LLM_PROVIDER:+$LLM_PROVIDER/}${LLM_MODEL}"

TUNNEL_URL="https://restaurant-chat.chaifamily.com.au"

# Kill existing server if running
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null

# Ensure Cloudflare tunnel is running via launchd
if ! launchctl list com.cloudflare.restaurant-chat &>/dev/null; then
  echo "Starting Cloudflare tunnel via launchd..."
  launchctl load ~/Library/LaunchAgents/com.cloudflare.restaurant-chat.plist 2>/dev/null
fi

# Start server (tsx for dev, or node dist/server.js for prod)
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting restaurant-chat ($DISPLAY_NAME)" | tee -a server.log
npx tsx src/server.ts >> server.log 2>&1 &
echo $! > server.pid
echo "Server PID $(cat server.pid) — logs → server.log"

sleep 2
echo ""
echo "════════════════════════════════════════════════"
echo "  🍛 Restaurant Chat is live!"
echo ""
echo "  Model:  $DISPLAY_NAME"
echo "  Local:  http://localhost:3456"
echo "  Public: $TUNNEL_URL"
echo "════════════════════════════════════════════════"
echo ""

# Post URL to WhatsApp group
WA_GROUP="${WA_GROUP:-}"
if [ -z "$WA_GROUP" ]; then
  echo "⚠️  No WA_GROUP in .env — skipping WhatsApp post"
  exit 0
fi
openclaw message send --channel whatsapp --target "$WA_GROUP" \
  --message "🍛 Restaurant Chat is live!

Model: $DISPLAY_NAME
Public: $TUNNEL_URL" \
  > /dev/null 2>&1 && echo "📱 Posted URL to WhatsApp group" || echo "⚠️  Failed to post to WhatsApp"
