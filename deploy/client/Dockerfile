# ==========================================
# FFP Tool Client Container (Frontend SPA & Static Server)
# Runs Nginx Alpine serving React UI and proxying API/WebSocket to Server container
# ==========================================

# Stage 1: Build Frontend SPA
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package.json
COPY package.json ./
RUN npm install

# Copy source and build
ARG VITE_AGENT_INSTALL_URL=https://ffp.b6-team.site
ENV VITE_AGENT_INSTALL_URL=${VITE_AGENT_INSTALL_URL}
COPY . .
RUN npm run build && \
    node scripts/package-agent-source.mjs /tmp/ffp-agent-package && \
    tar -czf /tmp/ffp-crawler-agent.tar.gz -C /tmp/ffp-agent-package . && \
    sha256sum /tmp/ffp-crawler-agent.tar.gz > /tmp/ffp-crawler-agent.tar.gz.sha256

# Stage 2: Lightweight Nginx Runtime
FROM nginx:1.27-alpine AS runner

# Remove default nginx assets
RUN apk add --no-cache apache2-utils && \
    rm -rf /usr/share/nginx/html/*

# Copy built SPA artifacts
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx configuration
COPY deploy/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/client/configure-operator-auth.sh /docker-entrypoint.d/10-configure-operator-auth.sh
RUN chmod 755 /docker-entrypoint.d/10-configure-operator-auth.sh

# Copy 1-command installer scripts so they can be downloaded directly from the web client
RUN mkdir -p /usr/share/nginx/html/scripts
COPY scripts/install-agent.ps1 /usr/share/nginx/html/scripts/install-agent.ps1
COPY scripts/agent-release-policy.ps1 /usr/share/nginx/html/scripts/agent-release-policy.ps1
COPY scripts/install-agent-source.ps1 /usr/share/nginx/html/scripts/install-agent-source.ps1
COPY scripts/install-agent.sh /usr/share/nginx/html/scripts/install-agent.sh
COPY scripts/update-agent.ps1 /usr/share/nginx/html/scripts/update-agent.ps1
COPY scripts/uninstall-agent.ps1 /usr/share/nginx/html/scripts/uninstall-agent.ps1
COPY cai-agent.bat /usr/share/nginx/html/scripts/cai-agent.bat
COPY --from=builder /tmp/ffp-crawler-agent.tar.gz /usr/share/nginx/html/downloads/ffp-crawler-agent.tar.gz
COPY --from=builder /tmp/ffp-crawler-agent.tar.gz.sha256 /usr/share/nginx/html/downloads/ffp-crawler-agent.tar.gz.sha256

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
