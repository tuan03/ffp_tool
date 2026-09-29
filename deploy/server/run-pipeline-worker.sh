#!/bin/sh
set -eu

if [ "${START_PIPELINE_WORKER:-false}" = "true" ]; then
  exec node --import tsx scripts/shopify-pipeline-worker.ts
fi

echo "[FFP Server] Shopify Pipeline Worker is disabled."
exec sleep infinity
