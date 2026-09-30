import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCustomGptRuntime } from "./custom-gpt-seo/runtime";
import { serveStaticFile } from "./static-server";

import { GatewayDispatcher } from "./dispatcher";
import { handleAutoSeoHttpRequest } from "./auto-seo-handler";
import { handleSeoReviewHttpRequest } from "./seo-review-handler";
import {
  handlePinterestPodDirectShopifySyncHttpRequest,
  handlePinterestPodSeoHttpRequest,
} from "./pinterest-pod-handler";
import { assertHostSecurity, createGatewayHttpHandler, isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { InMemoryIdempotencyStore } from "./idempotency";
import { ShopifyGraphqlClient } from "./shopify-graphql-client";
import { InMemoryStoreRegistry } from "./store-registry";
import { loadBootstrappedStores, loadLocalEnv } from "./store-config-loader";
import { InMemoryThrottleManager } from "./throttle-manager";
import { CompositeTokenProvider } from "./token-provider";
import { StoreControlPlane } from "./store-control-plane";
import {
  handleStoreRegistrationHttpRequest,
  handleProxyCheckHttpRequest,
  handleStoreUpdateHttpRequest,
  handleStoreDeleteHttpRequest,
  handleStoreGetHttpRequest,
} from "./store-control-handler";

function isContainerEnvironment(): boolean {
  try {
    return (
      fs.existsSync("/.dockerenv") ||
      fs.existsSync("/run/.containerenv") ||
      Boolean(
        process.env.CONTAINER ||
        process.env.DOCKER_CONTAINER ||
        process.env.KUBERNETES_SERVICE_HOST
      )
    );
  } catch {
    return false;
  }
}

export interface GatewayServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authToken?: string;
  readonly operatorUsername?: string;
  readonly operatorPassword?: string;
  readonly maxBodyBytes?: number;
}

function isOperatorAuthorized(
  authorization: string | undefined,
  username: string,
  password: string,
): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  let credentials: string;
  try {
    credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separatorIndex = credentials.indexOf(":");
  if (separatorIndex < 0) return false;
  const actualUsername = credentials.slice(0, separatorIndex);
  const actualPassword = credentials.slice(separatorIndex + 1);
  const actual = Buffer.from(`${actualUsername}\0${actualPassword}`);
  const expected = Buffer.from(`${username}\0${password}`);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requestOperatorAuthentication(res: http.ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="FFP Tool", charset="UTF-8"');
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end("Authentication required");
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
  const rawPort = options.port ?? env.GATEWAY_PORT ?? process.env.GATEWAY_PORT;
  const port = typeof rawPort === "number" ? rawPort : (Number(String(rawPort || "").trim()) || 3001);
  const rawAuthToken = options.authToken ?? env.GATEWAY_AUTH_TOKEN ?? process.env.GATEWAY_AUTH_TOKEN;
  const authToken = typeof rawAuthToken === "string" && rawAuthToken.trim().length > 0 ? rawAuthToken.trim() : undefined;
  const operatorUsername = options.operatorUsername ?? env.FFP_OPERATOR_USERNAME ?? process.env.FFP_OPERATOR_USERNAME;
  const operatorPassword = options.operatorPassword ?? env.FFP_OPERATOR_PASSWORD ?? process.env.FFP_OPERATOR_PASSWORD;
  const isContainer = isContainerEnvironment();
  const defaultHost = (isContainer && Boolean(authToken)) ? "0.0.0.0" : "127.0.0.1";
  const rawHost = options.host ?? env.GATEWAY_HOST ?? process.env.GATEWAY_HOST;
  const host = typeof rawHost === "string" && rawHost.trim().length > 0 ? rawHost.trim() : defaultHost;
  const maxBodyBytes = options.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

  assertHostSecurity(host, authToken, "gateway server");
  if (Boolean(operatorUsername) !== Boolean(operatorPassword)) {
    throw new Error("FFP_OPERATOR_USERNAME and FFP_OPERATOR_PASSWORD must be configured together");
  }
  if (operatorUsername && !authToken) {
    throw new Error("Operator authentication requires GATEWAY_AUTH_TOKEN");
  }

  const stores = loadBootstrappedStores({ env });
  if (env.GPT_SEO_ACTION_KEYS_JSON || process.env.GPT_SEO_ACTION_KEYS_JSON || env.GPT_SEO_ACTION_KEY || process.env.GPT_SEO_ACTION_KEY) getCustomGptRuntime();

  const storeRegistry = new InMemoryStoreRegistry(stores);
  const tokenProvider = new CompositeTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const idempotencyStore = new InMemoryIdempotencyStore();
  const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
  const httpHandler = createGatewayHttpHandler(dispatcher, {
    authToken,
    maxBodyBytes,
    challengeBasicAuth: Boolean(operatorUsername && operatorPassword),
  });
  const storeControlPlane = new StoreControlPlane({
    storeRegistry,
    tokenProvider,
    graphqlClient,
    persistConfigFile: "stores.local.json",
  });

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    const hasOperatorAuthentication = Boolean(operatorUsername && operatorPassword);
    const isAuthenticatedOperator = Boolean(
      operatorUsername &&
      operatorPassword &&
      isOperatorAuthorized(req.headers.authorization, operatorUsername, operatorPassword),
    );
    if (isAuthenticatedOperator && authToken) req.headers["x-gateway-key"] = authToken;

    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }
    if (hasOperatorAuthentication && !url.startsWith("/api/") && !isAuthenticatedOperator) {
      requestOperatorAuthentication(res);
      return;
    }
    if (url.startsWith("/api/v1/gpt-seo/")) {
      await getCustomGptRuntime().handler(req, res);
      return;
    }

    const isShopify = url === "/api/shopify" || url.startsWith("/api/shopify?");
    const isAutoSeo = url === "/api/auto-seo/run" || url.startsWith("/api/auto-seo/run?");
    const isPinterestPodHandover = url === "/api/pinterest-pod/handover-seo" || url.startsWith("/api/pinterest-pod/handover-seo?");
    const isPinterestPodDirectSync = url === "/api/pinterest-pod/sync-shopify" || url.startsWith("/api/pinterest-pod/sync-shopify?");
    const isSeoReview = url === "/api/seo-review" || url.startsWith("/api/seo-review/") || url.startsWith("/api/seo-review?");
    const isStoreRegister = url === "/api/stores/register" || url.startsWith("/api/stores/register?");
    const isStoreUpdate = url === "/api/stores/update" || url.startsWith("/api/stores/update?");
    const isStoreDelete = url === "/api/stores/delete" || url.startsWith("/api/stores/delete?");
    const isStoreGet = url === "/api/stores/get" || url.startsWith("/api/stores/get?");
    const isProxyCheck = url === "/api/proxy/check" || url.startsWith("/api/proxy/check?");

    if (isShopify || isAutoSeo || isStoreRegister || isStoreUpdate || isStoreDelete || isStoreGet) {
      try {
        const freshStores = loadBootstrappedStores({ env: loadLocalEnv() });
        const freshIds = new Set(freshStores.map((s) => s.storeId));
        for (const store of freshStores) {
          if (!storeRegistry.getStore(store.storeId)) {
            storeRegistry.registerStore(store);
          } else {
            storeRegistry.updateStore(store);
          }
        }
        for (const existing of storeRegistry.listStores()) {
          if (!freshIds.has(existing.storeId)) {
            storeRegistry.removeStore(existing.storeId);
          }
        }
      } catch {
        // non-fatal env sync in gateway server
      }
    }

    if (isShopify) {
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

    if (url === "/api/auto-seo/run" || url.startsWith("/api/auto-seo/run?")) {
      await handleAutoSeoHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (isPinterestPodHandover) {
      await handlePinterestPodSeoHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (isPinterestPodDirectSync) {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Gateway-Key");
        res.end();
        return;
      }
      await handlePinterestPodDirectShopifySyncHttpRequest(req, res, { authToken, maxBodyBytes, dispatcher });
      return;
    }

    if (url === "/api/stores/register" || url.startsWith("/api/stores/register?")) {
      await handleStoreRegistrationHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
      return;
    }

    if (url === "/api/stores/update" || url.startsWith("/api/stores/update?")) {
      await handleStoreUpdateHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
      return;
    }

    if (url === "/api/stores/delete" || url.startsWith("/api/stores/delete?")) {
      await handleStoreDeleteHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
      return;
    }

    if (url === "/api/stores/get" || url.startsWith("/api/stores/get?")) {
      await handleStoreGetHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
      return;
    }

    if (url === "/api/proxy/check" || url.startsWith("/api/proxy/check?")) {
      await handleProxyCheckHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (url.startsWith("/api/seo-review/") || url === "/api/seo-review") {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Gateway-Key");
        res.end();
        return;
      }
      await handleSeoReviewHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    const staticDir = process.env.STATIC_DIR
      ? path.resolve(process.env.STATIC_DIR)
      : path.resolve(process.cwd(), "dist");
    if (fs.existsSync(staticDir) && serveStaticFile(req, res, staticDir)) {
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  server.listen(port, host, () => {
    console.log(`[Shopify Gateway] Standalone server running on http://${host}:${port}/api/shopify`);
  });

  let isShuttingDown = false;
  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Shopify Gateway] Received ${signal}, closing server gracefully...`);

    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }

    const forceTimer = setTimeout(() => {
      console.warn("[Shopify Gateway] Forcing close of remaining connections after 10s timeout.");
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    }, 10_000);
    forceTimer.unref();

    server.close((err) => {
      clearTimeout(forceTimer);
      if (err) {
        console.error("[Shopify Gateway] Error while closing server:", err);
        process.exit(1);
      }
      console.log("[Shopify Gateway] Server closed successfully.");
      process.exit(0);
    });
  };

  const onSigterm = () => shutdown("SIGTERM");
  const onSigint = () => shutdown("SIGINT");
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  server.once("close", () => {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
  });

  return server;
}

const isCliDirectExecution = Boolean(
  process.argv[1] &&
  (
    import.meta.url === `file://${process.argv[1]}` ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  )
);

if (isCliDirectExecution) {
  const port = process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : undefined;
  const host = process.env.GATEWAY_HOST;
  const authToken = process.env.GATEWAY_AUTH_TOKEN;
  startGatewayServer({ port, host, authToken });
}
