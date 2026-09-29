#!/bin/sh
set -e

PIDS=""

shutdown() {
  echo "[FFP Unified Server] Shutdown signal received. Stopping all services..."
  for pid in $PIDS; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait
  echo "[FFP Unified Server] All services stopped cleanly."
  exit 0
}

trap shutdown INT TERM

# Ensure persistent directories exist
mkdir -p /app/.local-data /app/.runtime

echo "=========================================================="
echo " Starting FFP Unified Server (All Modules Backend)"
echo "=========================================================="

# 1. Start Python Amazon Crawler Coordinator (Port 8766)
echo "[FFP Server] Starting Amazon Crawler Coordinator on port ${COORDINATOR_PORT:-8766}..."
python3 -m uvicorn engine.distributed.coordinator_server:app \
  --app-dir /app/src/modules/amazon-crawler \
  --host 0.0.0.0 \
  --port "${COORDINATOR_PORT:-8766}" &
PIDS="$PIDS $!"

# 2. Start Shopify Pipeline Worker (if enabled)
if [ "$START_PIPELINE_WORKER" = "true" ]; then
  echo "[FFP Server] Starting Shopify Pipeline Worker..."
  node --import tsx scripts/shopify-pipeline-worker.ts &
  PIDS="$PIDS $!"
fi

# 3. Start Node.js Gateway & Core API (Port 3001)
echo "[FFP Server] Starting Gateway & API services on port ${GATEWAY_PORT:-3001}..."
node --import tsx gateway/server.ts &
PIDS="$PIDS $!"

echo "[FFP Server] All backend services are running. Monitoring..."
wait
