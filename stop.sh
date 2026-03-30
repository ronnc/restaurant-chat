#!/bin/bash
# Stop all restaurant-chat processes

echo "Stopping restaurant-chat..."

# Kill by PID file
if [ -f server.pid ]; then
  kill -9 $(cat server.pid) 2>/dev/null && echo "Killed server PID $(cat server.pid)"
  rm -f server.pid
fi

# Kill all tsx processes running our server
pkill -9 -f "tsx.*src/server" && echo "Killed tsx server processes"

# Kill all chromium/playwright browsers
pkill -9 -f chromium && echo "Killed chromium processes"
pkill -9 -f playwright && echo "Killed playwright processes"

# Kill any node processes on port 3456
lsof -ti:3456 | xargs kill -9 2>/dev/null && echo "Killed processes on port 3456"

sleep 1
echo "All processes stopped"
