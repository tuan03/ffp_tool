#!/bin/sh
set -eu

operator_username="${FFP_OPERATOR_USERNAME:-}"
operator_password="${FFP_OPERATOR_PASSWORD:-}"

if [ -z "$operator_username" ] || [ -z "$operator_password" ]; then
    echo "FFP_OPERATOR_USERNAME and FFP_OPERATOR_PASSWORD are required by the production client." >&2
    exit 1
fi

printf '%s\n' "$operator_password" | htpasswd -i -c -B /etc/nginx/.htpasswd "$operator_username" >/dev/null
chown nginx:nginx /etc/nginx/.htpasswd
chmod 600 /etc/nginx/.htpasswd
