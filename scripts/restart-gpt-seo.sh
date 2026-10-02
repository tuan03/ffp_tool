#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

docker compose config -q
docker compose up -d --build --force-recreate --wait --wait-timeout 120 server

HEALTH_URL="${GPT_SEO_HEALTH_URL:-https://ffp.b6-team.site/health}"
HEALTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL")"
if [[ "$HEALTH_STATUS" != "200" ]]; then
  echo "GPT SEO health check failed: $HEALTH_URL returned HTTP $HEALTH_STATUS." >&2
  exit 1
fi

echo "GPT SEO restarted successfully (HTTP 200)."
