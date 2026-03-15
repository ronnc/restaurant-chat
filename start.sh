#!/bin/bash
# Start restaurant-chat + Cloudflare tunnel
# Usage:
#   ./start.sh                           → Anthropic (Claude)
#   ./start.sh ollama                    → Ollama direct, default model (llama3.2:3b)
#   ./start.sh ollama llama3.1:8b        → Ollama direct, specific model
#   ./start.sh toy                       → chat-client-toy gateway (localhost:8100, start separately)
cd "$(dirname "$0")"

# Restaurant selection (env var or default)
export RESTAURANT="${RESTAURANT:-delhi-darbar}"

# Provider selection
PROVIDER="${1:-anthropic}"

# Load secrets from .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

export OLLAMA_URL=http://localhost:11434

case "$PROVIDER" in
  anthropic)
    export LLM_PROVIDER="anthropic"
    DISPLAY_NAME="anthropic/claude-sonnet"
    ;;
  ollama)
    export LLM_PROVIDER="ollama"
    export OLLAMA_MODEL="${2:-llama3.2:3b}"
    export LLM_GATEWAY_URL="http://localhost:11434"
    DISPLAY_NAME="ollama/$OLLAMA_MODEL"
    ;;
  toy)
    export LLM_PROVIDER="ollama"
    export OLLAMA_MODEL="${2:-llama3.1:8b}"
    export LLM_GATEWAY_URL="http://localhost:8100"
    DISPLAY_NAME="chat-client-toy/$OLLAMA_MODEL"
    ;;
  *)
    echo "Usage: $0 [anthropic|ollama|toy] [model]"
    exit 1
    ;;
esac

# Kill existing instances if running
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null
[ -f tunnel.pid ] && kill "$(cat tunnel.pid)" 2>/dev/null

# Start server
echo "$(date '+%Y-%m-%d %H:%M:%S') Starting restaurant-chat ($DISPLAY_NAME)" | tee -a server.log
node server.js >> server.log 2>&1 &
echo $! > server.pid
echo "Server PID $(cat server.pid) — logs → server.log"

# Start Cloudflare tunnel
sleep 1
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
