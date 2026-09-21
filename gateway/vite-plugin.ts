import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

import { GatewayDispatcher } from "./dispatcher";
import { createGatewayHttpHandler } from "./http-server";
import { InMemoryIdempotencyStore } from "./idempotency";
import { ShopifyGraphqlClient } from "./shopify-graphql-client";
import { InMemoryStoreRegistry } from "./store-registry";
import { InMemoryThrottleManager } from "./throttle-manager";
import { CompositeTokenProvider } from "./token-provider";
import type { StoreConfig } from "./types";

function loadLocalEnv(): Record<string, string> {
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

export function shopifyGatewayDevPlugin(): Plugin {
  return {
    name: "shopify-gateway-dev",
    configureServer(server) {
      const env = loadLocalEnv();
      const stores: StoreConfig[] = [];

      const clientId = env.GATEWAY_CLIENT_ID;
      const clientSecret = env.GATEWAY_CLIENT_SECRET;
      const storeId = env.GATEWAY_STORE_ID || "capozen";
      const shopDomain = env.GATEWAY_SHOP_DOMAIN || "capozen.myshopify.com";

      if (clientId && clientSecret) {
        stores.push({
          storeId,
          shopDomain,
          apiVersion: "2026-07",
          auth: {
            type: "client_credentials",
            clientId,
            clientSecret,
          },
        });
      }

      const storeRegistry = new InMemoryStoreRegistry(stores);
      const tokenProvider = new CompositeTokenProvider();
      const throttleManager = new InMemoryThrottleManager();
      const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
      const idempotencyStore = new InMemoryIdempotencyStore();
      const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
      const httpHandler = createGatewayHttpHandler(dispatcher);

      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url === "/api/shopify" || req.url.startsWith("/api/shopify?")) && req.method === "POST") {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            const body = Buffer.concat(chunks);
            const protocol = req.headers["x-forwarded-proto"] || "http";
            const host = req.headers.host || "localhost:5173";
            const webReq = new Request(`${protocol}://${host}${req.url}`, {
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
          } catch (err: unknown) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: { code: "SHOPIFY_NETWORK_ERROR", message: "Gateway Middleware Error" },
              }),
            );
          }
        } else {
          next();
        }
      });
    },
  };
}
