# ==========================================
# FFP Tool Client Container (Frontend SPA & Static Server)
# Runs Nginx Alpine serving React UI and proxying API/WebSocket to Server container.
#
# Production optimization:
# Client artifacts are pre-built via `npm run build:client` and
# crawler agent package via `scripts/package-agent-source.mjs` (scripts/package-crawler-agent.mjs).
# Eliminates Node.js, Python, compilers and npm install from the production container.
# ==========================================

FROM nginx:1.27-alpine AS runner

# Remove default nginx assets
RUN apk add --no-cache apache2-utils && \
    rm -rf /usr/share/nginx/html/*

# Copy built SPA artifacts and distribution packages
COPY dist /usr/share/nginx/html

# Copy Nginx configuration
COPY deploy/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/client/configure-operator-auth.sh /docker-entrypoint.d/10-configure-operator-auth.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-configure-operator-auth.sh && \
    chmod 755 /docker-entrypoint.d/10-configure-operator-auth.sh

# Copy 1-command installer scripts so they can be downloaded directly from the web client
RUN mkdir -p /usr/share/nginx/html/scripts
COPY scripts/install-agent.ps1 /usr/share/nginx/html/scripts/install-agent.ps1
COPY scripts/agent-release-policy.ps1 /usr/share/nginx/html/scripts/agent-release-policy.ps1
COPY scripts/install-agent-source.ps1 /usr/share/nginx/html/scripts/install-agent-source.ps1
COPY scripts/install-agent.sh /usr/share/nginx/html/scripts/install-agent.sh
COPY scripts/update-agent.ps1 /usr/share/nginx/html/scripts/update-agent.ps1
COPY scripts/uninstall-agent.ps1 /usr/share/nginx/html/scripts/uninstall-agent.ps1
COPY cai-agent.bat /usr/share/nginx/html/scripts/cai-agent.bat

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
