# ==========================================
# Stage 1: Build Frontend SPA & Install Dependencies
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install native build tools for compiling native addons (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==========================================
# Stage 2: Production Runtime
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=3001 \
    STATIC_DIR=/app/dist

# Install runtime ca-certificates for outbound HTTPS (Shopify / Google Suggest)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-compiled node_modules (including native better-sqlite3 and tsx) and built frontend from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy backend application files
COPY package.json ./
COPY gateway ./gateway
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json tsconfig.gateway.json tsconfig.pipeline.json ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh && \
    mkdir -p /app/.local-data /app/.runtime

EXPOSE 3001

ENTRYPOINT ["./docker-entrypoint.sh"]
