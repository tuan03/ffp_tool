import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCustomGptRuntime } from "./custom-gpt-seo/runtime";
import { createSeoPublishTransport } from "./seo-worker/publish-transport";
import { configurePerformanceRuntime, getPerformanceService, closePerformanceRuntime } from "./seo-performance/runtime";
import { handlePerformanceHttp } from "./seo-performance/http-handler";
import { handleSeoAgentHttp } from "./seo-worker/admin-handler";
import { createSeoRevision } from "./seo-worker/revision-service";
import { handleWorkerMcp } from "./seo-worker/mcp-handler";
import { createWorkerWorkflow } from "./seo-worker/workflow";
import { createWorkerSourceGuard } from "./seo-worker/source-guard";
import { serveStaticFile } from "./static-server";

import { GatewayDispatcher } from "./dispatcher";
import { handleAutoSeoEligibilityHttpRequest, handleAutoSeoHttpRequest } from "./auto-seo-handler";
import { handleAmazonReviewsHttpRequest } from "./amazon-reviews-handler";
import { getAutoSeoDatabaseUrl } from "./auto-seo-database-url";
import { bootstrapAutoSeoSchema } from "./auto-seo-startup";
import type { AutoSeoStartupOptions } from "./auto-seo-startup";
import { handleSeoReviewHttpRequest } from "./seo-review-handler";
import { handleReviewImageHttpRequest } from "./review-image-handler";
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

export interface GatewayServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authToken?: string;
  readonly operatorUsername?: string;
  readonly operatorPassword?: string;
  readonly maxBodyBytes?: number;
  readonly reviewImageBridgeBaseUrl?: string;
  readonly customGptHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
}

export function getRuntimeStoreConfigFile(env: Readonly<Record<string, string>>): string {
  return env.GATEWAY_STORES_FILE?.trim() || ".runtime/stores.local.json";
}

function formatAutoSeoStartupFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  return message.replace(/postgres(?:ql)?(?:\+[a-z0-9]+)?:\/\/[^\s"']+/gi, "postgresql://[redacted]");
}

export async function startGatewayServerWhenReady(
  options: GatewayServerOptions,
  startupOptions?: AutoSeoStartupOptions,
): Promise<http.Server> {
  await bootstrapAutoSeoSchema(startupOptions);
  return startGatewayServer(options);
}

/**
 * Starts core Gateway routes even when Auto SEO persistence has not been
 * provisioned yet. Auto SEO routes then return their explicit configuration
 * error; they never fall back to SQLite.
 */
export async function startGatewayServerWithOptionalAutoSeo(
  options: GatewayServerOptions,
  startupOptions?: AutoSeoStartupOptions,
): Promise<http.Server> {
  const databaseUrl = startupOptions?.databaseUrl ?? getAutoSeoDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[Auto SEO] PostgreSQL is not configured; Auto SEO routes are unavailable while core Gateway routes remain online.");
    return startGatewayServer(options);
  }
  return startGatewayServerWhenReady(options, { ...startupOptions, databaseUrl });
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
  const port = options.port ?? (Number(env.GATEWAY_PORT || process.env.GATEWAY_PORT) || 3001);
  const host = options.host ?? env.GATEWAY_HOST ?? process.env.GATEWAY_HOST ?? "127.0.0.1";
  const authToken = options.authToken ?? env.GATEWAY_AUTH_TOKEN ?? process.env.GATEWAY_AUTH_TOKEN;
  const operatorUsername = options.operatorUsername ?? env.FFP_OPERATOR_USERNAME ?? process.env.FFP_OPERATOR_USERNAME;
  const operatorPassword = options.operatorPassword ?? env.FFP_OPERATOR_PASSWORD ?? process.env.FFP_OPERATOR_PASSWORD;
  const maxBodyBytes = options.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

  assertHostSecurity(host, authToken, "gateway server");
  if (Boolean(operatorUsername) !== Boolean(operatorPassword)) {
    throw new Error("FFP_OPERATOR_USERNAME and FFP_OPERATOR_PASSWORD must be configured together");
  }
  if (operatorUsername && !authToken) {
    throw new Error("Operator authentication requires GATEWAY_AUTH_TOKEN");
  }

  const storeConfigFile = getRuntimeStoreConfigFile(env);
  const stores = loadBootstrappedStores({ env, configFile: storeConfigFile });
  if (!options.customGptHandler && getAutoSeoDatabaseUrl() && (env.GPT_SEO_ACTION_KEYS_JSON || env.GPT_SEO_ACTION_KEY || env.GPT_SEO_MCP_KEYS_JSON)) getCustomGptRuntime();

  const storeRegistry = new InMemoryStoreRegistry(stores);
  const tokenProvider = new CompositeTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const idempotencyStore = new InMemoryIdempotencyStore();
  const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
  const isBackendPublishEnabled = (process.env.SEO_WORKER_PUBLISH_ENABLED ?? env.SEO_WORKER_PUBLISH_ENABLED) === "true" && Boolean(operatorUsername) && Boolean(getAutoSeoDatabaseUrl());
  if (isBackendPublishEnabled) getCustomGptRuntime().configurePublisher(createSeoPublishTransport(dispatcher));
  configurePerformanceRuntime(dispatcher, () => getCustomGptRuntime().queue);
  const httpHandler = createGatewayHttpHandler(dispatcher, { authToken, maxBodyBytes });
  const storeControlPlane = new StoreControlPlane({
    storeRegistry,
    tokenProvider,
    graphqlClient,
    persistConfigFile: storeConfigFile,
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
    if (url === "/mcp/gpt-seo" || url.startsWith("/mcp/gpt-seo?")) {
      if (!getAutoSeoDatabaseUrl()) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { code: "SEO_QUEUE_DATABASE_URL_REQUIRED", message: "SEO Queue requires PostgreSQL configuration" } }));
        return;
      }
      await getCustomGptRuntime().mcpHandler(req, res);
      return;
    }
    if (url === "/mcp/seo-worker") {
      try {
        const runtime = getCustomGptRuntime(); await runtime.initialize();
        await handleWorkerMcp(req, res, runtime.queue.workers, createWorkerWorkflow(runtime.queue.workers, {
          checkSource: createWorkerSourceGuard(dispatcher),
          performanceEvidence: async job => getPerformanceService()?.workerProductEvidence(
            job.execution.storeId,
            job.execution.productId ?? job.execution.sourceIdentity,
          ) ?? { status: "disabled" },
        }), getPerformanceService);
      } catch { if (!res.headersSent) { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "WORKER_UNAVAILABLE" } })); } }
      return;
    }
    if (hasOperatorAuthentication && !url.startsWith("/api/") && !isAuthenticatedOperator) {
      requestOperatorAuthentication(res);
      return;
    }
    if (url.startsWith("/api/seo-performance/")) {
      await handlePerformanceHttp(req, res, { service: getPerformanceService(), authToken, hasStore: storeId => storeRegistry.hasStore(storeId) });
      return;
    }
    if (url.startsWith("/api/review-images/")) {
      await handleReviewImageHttpRequest(req, res, {
        authToken,
        bridgeToken: env.REVIEW_IMAGE_BRIDGE_TOKEN || process.env.REVIEW_IMAGE_BRIDGE_TOKEN || "change-this-token",
        bridgeBaseUrl: options.reviewImageBridgeBaseUrl ?? env.REVIEW_IMAGE_BRIDGE_URL,
        durableUploads: env.REVIEW_IMAGE_DURABLE_UPLOADS === "true",
        reviewImageOutputDir: env.REVIEW_IMAGE_OUTPUT_DIR,
        dispatcher,
      });
      return;
    }
    if (url.startsWith("/api/seo-agent/")) {
      await handleSeoAgentHttp(req, res, {
        operator: isAuthenticatedOperator ? operatorUsername : undefined,
        hasStore: storeId => storeRegistry.hasStore(storeId),
        listStoreIds: () => storeRegistry.listStores().map(store => store.storeId),
        repository: async () => { const runtime = getCustomGptRuntime(); await runtime.initialize(); return runtime.queue.workers; },
        publisher: isBackendPublishEnabled ? async () => { const runtime = getCustomGptRuntime(); await runtime.initialize(); return runtime.queue.publisher; } : undefined,
        createRevision: async request => { const runtime = getCustomGptRuntime(); await runtime.initialize(); return createSeoRevision(runtime.queue, dispatcher, request); },
        history: async (storeId, jobId, offset) => { const runtime = getCustomGptRuntime(); await runtime.initialize(); return runtime.queue.workerHistory.list(storeId, jobId, offset); },
      });
      return;
    }
    if (url.startsWith("/api/v1/gpt-seo/")) {
      if (!options.customGptHandler && !getAutoSeoDatabaseUrl()) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { code: "SEO_QUEUE_DATABASE_URL_REQUIRED", message: "SEO Queue requires PostgreSQL configuration" } }));
        return;
      }
      await (options.customGptHandler ?? getCustomGptRuntime().handler)(req, res);
      return;
    }

    const isShopify = url === "/api/shopify" || url.startsWith("/api/shopify?");
    const isAutoSeoRun = url === "/api/auto-seo/run" || url.startsWith("/api/auto-seo/run?");
    const isAutoSeoEligibility = url === "/api/auto-seo/eligibility" || url.startsWith("/api/auto-seo/eligibility?");
    const isAutoSeo = isAutoSeoRun || isAutoSeoEligibility;
    const isPinterestPodHandover = url === "/api/pinterest-pod/handover-seo" || url.startsWith("/api/pinterest-pod/handover-seo?");
    const isPinterestPodDirectSync = url === "/api/pinterest-pod/sync-shopify" || url.startsWith("/api/pinterest-pod/sync-shopify?");
    const isStoreRegister = url === "/api/stores/register" || url.startsWith("/api/stores/register?");
    const isStoreUpdate = url === "/api/stores/update" || url.startsWith("/api/stores/update?");
    const isStoreDelete = url === "/api/stores/delete" || url.startsWith("/api/stores/delete?");
    const isStoreGet = url === "/api/stores/get" || url.startsWith("/api/stores/get?");
    const isProxyCheck = url === "/api/proxy/check" || url.startsWith("/api/proxy/check?");

    if (isShopify || isAutoSeo || isStoreRegister || isStoreUpdate || isStoreDelete || isStoreGet) {
      try {
        const freshEnv = loadLocalEnv();
        const freshStores = loadBootstrappedStores({
          env: freshEnv,
          configFile: getRuntimeStoreConfigFile(freshEnv),
        });
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

    if (isAutoSeoRun) {
      await handleAutoSeoHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }
    if (isAutoSeoEligibility) {
      await handleAutoSeoEligibilityHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (url === "/api/amazon-reviews/samples") {
      await handleAmazonReviewsHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (isPinterestPodHandover) {
      await handlePinterestPodSeoHttpRequest(req, res, { authToken, maxBodyBytes });
      return;
    }

    if (isPinterestPodDirectSync) {
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

    if (url.startsWith("/api/seo-review/")) {
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

  server.on("close", () => { void closePerformanceRuntime().catch(() => { console.error("[SEO Performance] Shutdown failed."); }); });
  server.listen(port, host, () => {
    console.log(`[Shopify Gateway] Standalone server running on http://${host}:${port}/api/shopify`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.GATEWAY_PORT) || 3001;
  const host = process.env.GATEWAY_HOST || "127.0.0.1";
  let seoRuntime: ReturnType<typeof getCustomGptRuntime> | undefined;
  try {
    if (getAutoSeoDatabaseUrl()) {
      seoRuntime = getCustomGptRuntime();
      await seoRuntime.initialize();
    }
    await startGatewayServerWithOptionalAutoSeo({ port, host });
  } catch (error) {
    await seoRuntime?.close();
    console.error(`[Auto SEO] PostgreSQL schema initialization failed; Gateway did not start: ${formatAutoSeoStartupFailure(error)}`);
    process.exitCode = 1;
  }
}
