#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# FFP Tool - VPS Host Infrastructure Setup (Run ONCE on new VPS)
# Configures host Nginx reverse proxy and Let's Encrypt SSL certificate.
# Usage:
#   sudo bash scripts/setup-vps-host.sh [DOMAIN] [CLIENT_PORT]
# Example:
#   sudo bash scripts/setup-vps-host.sh ffp.b6-team.site 3010
# ==============================================================================

DOMAIN="${1:-ffp.b6-team.site}"
CLIENT_PORT="${2:-3010}"

echo "=== Setting up Host Nginx Reverse Proxy for $DOMAIN (target: 127.0.0.1:$CLIENT_PORT) ==="

# Ensure nginx and certbot are installed
if ! command -v nginx >/dev/null 2>&1; then
  echo "Installing nginx..."
  sudo apt-get update && sudo apt-get install -y nginx
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing certbot and python3-certbot-nginx..."
  sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx
fi

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN.conf"

sudo bash -c "printf '%s\n' \
  'server {' \
  '    listen 80;' \
  '    listen [::]:80;' \
  '    server_name $DOMAIN;' \
  '    client_max_body_size 50M;' \
  '    location / {' \
  '        proxy_pass http://127.0.0.1:$CLIENT_PORT;' \
  '        proxy_http_version 1.1;' \
  '        proxy_set_header Upgrade \$http_upgrade;' \
  '        proxy_set_header Connection \"upgrade\";' \
  '        proxy_set_header Host \$host;' \
  '        proxy_set_header X-Real-IP \$remote_addr;' \
  '        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;' \
  '        proxy_set_header X-Forwarded-Proto \$scheme;' \
  '        proxy_connect_timeout 60s;' \
  '        proxy_send_timeout 300s;' \
  '        proxy_read_timeout 300s;' \
  '    }' \
  '}' > '$NGINX_CONF'"

sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
sudo nginx -t
sudo systemctl reload nginx

echo "=== Requesting SSL Certificate from Let's Encrypt ==="
if ! sudo grep -q "ssl_certificate" "$NGINX_CONF" 2>/dev/null; then
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
    echo "Certbot reported a warning. Verify DNS for $DOMAIN." >&2
  }
fi

echo "✅ Host Nginx and SSL setup complete for https://$DOMAIN"
