#!/bin/sh
set -e

PIDS=""

shutdown() {
  echo "[FFP Tool] Received shutdown signal. Terminating child processes..."
  for pid in $PIDS; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait
  exit 0
}

trap shutdown INT TERM

# Ensure directories for SQLite databases and runtime corpus exist
mkdir -p /app/.local-data /app/.runtime

if [ "$START_PIPELINE_WORKER" = "true" ]; then
  echo "[FFP Tool] Starting Shopify Pipeline Worker..."
  node --import tsx scripts/shopify-pipeline-worker.ts &
  PIDS="$PIDS $!"
fi

echo "[FFP Tool] Starting FFP Gateway & Web Application on port ${GATEWAY_PORT:-3001}..."
node --import tsx gateway/server.ts &
PIDS="$PIDS $!"

wait
