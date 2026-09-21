import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";

import { GatewayDispatcher } from "./dispatcher";
import { createGatewayHttpHandler } from "./http-server";
import { InMemoryIdempotencyStore } from "./idempotency";
import { ShopifyGraphqlClient } from "./shopify-graphql-client";
import { InMemoryStoreRegistry } from "./store-registry";
import { InMemoryThrottleManager } from "./throttle-manager";
import { CompositeTokenProvider } from "./token-provider";
import type { StoreConfig } from "./types";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const envPath = resolve(process.cwd(), ".env.local");

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        env[key] = val;
      }
    }
  }

  return env;
}

export function startGatewayServer(port: number = 3001): http.Server {
  const env = loadEnv();
  const stores: StoreConfig[] = [];

  const clientId = env.GATEWAY_CLIENT_ID;
  const clientSecret = env.GATEWAY_CLIENT_SECRET;
  const staticToken = env.GATEWAY_ACCESS_TOKEN;
  const storeId = env.GATEWAY_STORE_ID || "capozen";
  const shopDomain = env.GATEWAY_SHOP_DOMAIN || "capozen.myshopify.com";
  const niche = env.GATEWAY_STORE_NICHE;

  if ((clientId && clientSecret) || staticToken) {
    const proxyUrl = env.GATEWAY_PROXY_URL;
    const proxy = proxyUrl
      ? {
          url: proxyUrl,
          username: env.GATEWAY_PROXY_USERNAME || undefined,
          password: env.GATEWAY_PROXY_PASSWORD || undefined,
          failClosed: true,
        }
      : undefined;

    const auth = clientId && clientSecret
      ? ({
          type: "client_credentials" as const,
          clientId,
          clientSecret,
        })
      : ({
          type: "static" as const,
          staticToken: staticToken!,
        });

    stores.push({
      storeId,
      shopDomain,
      apiVersion: "2026-07",
      auth,
      proxy,
      niche,
    });
  }

  const storeRegistry = new InMemoryStoreRegistry(stores);
  const tokenProvider = new CompositeTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const idempotencyStore = new InMemoryIdempotencyStore();
  const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
  const httpHandler = createGatewayHttpHandler(dispatcher);

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }

    if ((url === "/api/shopify" || url.startsWith("/api/shopify?")) && req.method === "POST") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks);
        const protocol = req.headers["x-forwarded-proto"] || "http";
        const host = req.headers.host || `localhost:${port}`;
        const webReq = new Request(`${protocol}://${host}${url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body,
        });

        const webRes = await httpHandler(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const resBuffer = await webRes.arrayBuffer();
        res.end(Buffer.from(resBuffer));
      } catch {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: false,
            error: { code: "SHOPIFY_NETWORK_ERROR", message: "Gateway Server Error" },
          }),
        );
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  server.listen(port, () => {
    console.log(`[Shopify Gateway] Standalone server running on http://localhost:${port}/api/shopify`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.GATEWAY_PORT) || 3001;
  startGatewayServer(port);
}
