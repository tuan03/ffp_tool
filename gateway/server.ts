import http from "node:http";

import { GatewayDispatcher } from "./dispatcher";
import { createGatewayHttpHandler, isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { InMemoryIdempotencyStore } from "./idempotency";
import { ShopifyGraphqlClient } from "./shopify-graphql-client";
import { InMemoryStoreRegistry } from "./store-registry";
import { loadBootstrappedStores, loadLocalEnv } from "./store-config-loader";
import { InMemoryThrottleManager } from "./throttle-manager";
import { CompositeTokenProvider } from "./token-provider";

export interface GatewayServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

export function startGatewayServer(
  portOrOptions?: number | GatewayServerOptions,
  hostParam?: string,
): http.Server {
  const options: GatewayServerOptions =
    typeof portOrOptions === "object" && portOrOptions !== null
      ? portOrOptions
      : { port: portOrOptions, host: hostParam };

  const env = loadLocalEnv();
  const port = options.port ?? (Number(env.GATEWAY_PORT || process.env.GATEWAY_PORT) || 3001);
  const host = options.host ?? env.GATEWAY_HOST ?? process.env.GATEWAY_HOST ?? "127.0.0.1";
  const authToken = options.authToken ?? env.GATEWAY_AUTH_TOKEN ?? process.env.GATEWAY_AUTH_TOKEN;
  const maxBodyBytes = options.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

  const isLocalHost =
    host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  const hasAuthToken = typeof authToken === "string" && authToken.trim().length > 0;
  if (!isLocalHost && !hasAuthToken) {
    throw new Error(
      `Refusing to start gateway server on host '${host}' without GATEWAY_AUTH_TOKEN. Unauthenticated public exposure is prohibited.`,
    );
  }

  const stores = loadBootstrappedStores({ env });

  const storeRegistry = new InMemoryStoreRegistry(stores);
  const tokenProvider = new CompositeTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const idempotencyStore = new InMemoryIdempotencyStore();
  const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
  const httpHandler = createGatewayHttpHandler(dispatcher, { authToken, maxBodyBytes });

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }

    if (url === "/api/shopify" || url.startsWith("/api/shopify?")) {
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
        const reqHost = req.headers.host || `${host}:${port}`;
        const webReq = new Request(`${protocol}://${reqHost}${url}`, {
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

  server.listen(port, host, () => {
    console.log(`[Shopify Gateway] Standalone server running on http://${host}:${port}/api/shopify`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.GATEWAY_PORT) || 3001;
  const host = process.env.GATEWAY_HOST || "127.0.0.1";
  startGatewayServer({ port, host });
}
