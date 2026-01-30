#!/bin/sh

# Wait a moment for volume to be mounted
sleep 2

# Check if data directory exists (should be mounted by Railway volume)
if [ ! -d "/app/data" ]; then
  echo "[Start] Creating /app/data directory..."
  mkdir -p /app/data
else
  echo "[Start] /app/data directory exists (volume mounted)"
fi

# List contents for debugging
echo "[Start] Contents of /app/data:"
ls -la /app/data/ || echo "[Start] Directory is empty or not accessible"

# Start the server
echo "[Start] Starting Node.js server..."
node index.js
