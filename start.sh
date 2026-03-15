#!/bin/bash
# Start restaurant-chat + Cloudflare tunnel
# Usage:
#   ./start.sh                              → default (Ollama llama3.1:8b)
#   ./start.sh llama3.2:3b                  → override model (auto-detect provider)
#   ./start.sh claude-sonnet-4-20250514              → auto-picks Anthropic
#   ./start.sh gpt-4o openai                → explicit provider
cd "$(dirname "$0")"

# Load secrets from .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Allow model + provider override via CLI args
if [ -n "$1" ]; then
  export LLM_MODEL="$1"
fi
if [ -n "$2" ]; then
  export LLM_PROVIDER="$2"
fi

export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.0.30:11434/v1}"
export LLM_MODEL="${LLM_MODEL:-llama3.1:8b}"
export RESTAURANT="${RESTAURANT:-delhi-darbar}"

DISPLAY_NAME="${LLM_PROVIDER:+$LLM_PROVIDER/}${LLM_MODEL}"

# Kill existing instances if running
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null
[ -f tunnel.pid ] && kill "$(cat tunnel.pid)" 2>/dev/null

# Start server (tsx for dev, or node dist/server.js for prod)
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting restaurant-chat ($DISPLAY_NAME)" | tee -a server.log
npx tsx src/server.ts >> server.log 2>&1 &
echo $! > server.pid
echo "Server PID $(cat server.pid) — logs → server.log"

# Start Cloudflare tunnel
sleep 2
nohup cloudflared tunnel --url http://localhost:3456 >> tunnel.log 2>&1 &
echo $! > tunnel.pid
echo "Tunnel PID $(cat tunnel.pid) — logs → tunnel.log"
echo "Waiting for tunnel URL..."
sleep 12
TUNNEL_URL=$(grep -o 'https://[^ ]*trycloudflare.com' tunnel.log | tail -1)
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
