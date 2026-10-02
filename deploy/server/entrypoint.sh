#!/bin/sh
set -eu

mkdir -p /app/.local-data /app/.runtime/pinterest-pod/jobs /app/.runtime/pinterest-pod/output

if [ -z "${PINTEREST_APP_ID:-}" ] || [ -z "${PINTEREST_APP_SECRET:-}" ]; then
  echo "[ffp-server] Pinterest OAuth is not configured; official Trends discovery will be disabled."
fi

exec /usr/bin/supervisord -c /app/deploy/server/supervisord.conf
