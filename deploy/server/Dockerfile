# ==========================================
# FFP Unified Server Container (All Modules Backend)
# Runs: Node.js Gateway + Python Crawler Coordinator + Pipeline Worker
# ==========================================
FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NODE_ENV=production \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=3001 \
    COORDINATOR_PORT=8766 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PATH="/opt/venv/bin:$PATH"

# Install Python 3, build tools for native modules (better-sqlite3, psycopg), and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libpq-dev \
    gcc \
    g++ \
    make \
    curl \
    ca-certificates \
    procps \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# 1. Setup Python virtual environment & install dependencies
COPY deploy/server/requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

# 2. Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# 3. Copy application backend source files
COPY gateway ./gateway
COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY tsconfig.json tsconfig.gateway.json tsconfig.pipeline.json ./
COPY deploy/server/entrypoint.sh /app/entrypoint.sh
COPY deploy/server/supervisord.conf /app/deploy/server/supervisord.conf
COPY deploy/server/run-pipeline-worker.sh /app/deploy/server/run-pipeline-worker.sh

RUN sed -i 's/\r$//' /app/entrypoint.sh /app/deploy/server/run-pipeline-worker.sh && \
    chmod +x /app/entrypoint.sh /app/deploy/server/run-pipeline-worker.sh && \
    mkdir -p /app/.local-data /app/.runtime

# Gateway (3001), Coordinator (8766) & internal Pinterest POD (8768)
EXPOSE 3001 8766 8768

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3001/health >/dev/null && curl -fsS http://127.0.0.1:8766/api/v1/health >/dev/null && curl -fsS http://127.0.0.1:8768/ready >/dev/null || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
