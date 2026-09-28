# ==========================================
# Stage 1: Build Frontend SPA & Install Dependencies
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install native build tools for compiling native addons (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json without platform-locked package-lock to avoid npm issue #4828
# This guarantees Linux-x64 native bindings (@rolldown/binding-linux-x64-gnu, @tailwindcss/oxide) are downloaded
COPY package.json ./
RUN npm install

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

# Copy pre-compiled node_modules (including native better-sqlite3 and linux bindings) and built frontend
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
