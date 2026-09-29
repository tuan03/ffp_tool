#!/bin/sh
set -eu

mkdir -p /app/.local-data /app/.runtime/pinterest-pod/jobs /app/.runtime/pinterest-pod/output

exec /usr/bin/supervisord -c /app/deploy/server/supervisord.conf
