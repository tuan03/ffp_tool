#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' ffp-tool-app)"
if [[ -z "$CURRENT_IMAGE" ]]; then
  echo "Cannot determine the image used by ffp-tool-app." >&2
  exit 1
fi

export DOCKER_IMAGE="$CURRENT_IMAGE"
export APP_PORT="${APP_PORT:-3010}"

docker compose -f compose.prod.yaml config -q
docker compose -f compose.prod.yaml up -d --force-recreate --wait --wait-timeout 120 app

HEALTH_URL="${GPT_SEO_HEALTH_URL:-https://ffp.b6-team.site/health}"
HEALTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL")"
if [[ "$HEALTH_STATUS" != "200" ]]; then
  echo "GPT SEO health check failed: $HEALTH_URL returned HTTP $HEALTH_STATUS." >&2
  exit 1
fi

echo "GPT SEO restarted successfully (HTTP 200)."
