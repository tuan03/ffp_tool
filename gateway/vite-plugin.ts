import type { Plugin } from "vite";

import { GatewayDispatcher } from "./dispatcher";
import { assertHostSecurity, createGatewayHttpHandler, isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { InMemoryIdempotencyStore } from "./idempotency";
import { ShopifyGraphqlClient } from "./shopify-graphql-client";
import { InMemoryStoreRegistry } from "./store-registry";
import { loadBootstrappedStores, loadLocalEnv } from "./store-config-loader";
import { InMemoryThrottleManager } from "./throttle-manager";
import { CompositeTokenProvider } from "./token-provider";

export interface ShopifyGatewayDevPluginOptions {
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

export function shopifyGatewayDevPlugin(options?: ShopifyGatewayDevPluginOptions): Plugin {
  return {
    name: "shopify-gateway-dev",
    configureServer(server) {
      const env = loadLocalEnv();
      const rawAuthToken = options?.authToken ?? env.GATEWAY_AUTH_TOKEN ?? process.env.GATEWAY_AUTH_TOKEN;
      const authToken =
        typeof rawAuthToken === "string" && rawAuthToken.trim() !== ""
          ? rawAuthToken.trim()
          : undefined;
      const host = server?.config?.server?.host;
      assertHostSecurity(host, authToken, "vite dev server");
      const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

      const stores = loadBootstrappedStores({ env });

      const storeRegistry = new InMemoryStoreRegistry(stores);
      const tokenProvider = new CompositeTokenProvider();
      const throttleManager = new InMemoryThrottleManager();
      const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
      const idempotencyStore = new InMemoryIdempotencyStore();
      const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
      const httpHandler = createGatewayHttpHandler(dispatcher, { authToken, maxBodyBytes });

      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url === "/api/shopify" || req.url.startsWith("/api/shopify?"))) {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: { code: "SHOPIFY_INVALID_INPUT", message: "Method Not Allowed" },
              }),
            );
            return;
          }

          if (authToken && !isGatewayAuthorized(req.headers, authToken)) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: {
                  code: "SHOPIFY_AUTH_FAILED",
                  message: "Unauthorized: Invalid or missing Gateway authentication token",
                },
              }),
            );
            return;
          }

          try {
            const clHeader = req.headers["content-length"];
            if (clHeader) {
              const cl = Number.parseInt(clHeader, 10);
              if (!Number.isNaN(cl) && cl > maxBodyBytes) {
                req.destroy();
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: {
                      code: "SHOPIFY_INVALID_INPUT",
                      message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
                    },
                  }),
                );
                return;
              }
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;
            for await (const chunk of req) {
              const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
              totalBytes += buf.length;
              if (totalBytes > maxBodyBytes) {
                req.destroy();
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: {
                      code: "SHOPIFY_INVALID_INPUT",
                      message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
                    },
                  }),
                );
                return;
              }
              chunks.push(buf);
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
