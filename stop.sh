#!/bin/bash
# Stop restaurant-chat + Cloudflare tunnel
cd "$(dirname "$0")"

for service in server tunnel; do
  if [ -f "${service}.pid" ]; then
    PID=$(cat "${service}.pid")
    if kill "$PID" 2>/dev/null; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') Stopped $service (PID $PID)" | tee -a server.log
    else
      echo "$service (PID $PID) not running (stale pid)"
    fi
    rm "${service}.pid"
  else
    echo "No ${service}.pid found"
  fi
done
