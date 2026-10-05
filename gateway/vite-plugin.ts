import type { Plugin } from "vite";

import { GatewayDispatcher } from "./dispatcher";
import { getCustomGptRuntime } from "./custom-gpt-seo/runtime";
import { handleAutoSeoEligibilityHttpRequest, handleAutoSeoHttpRequest } from "./auto-seo-handler";
import { handleAmazonReviewsHttpRequest } from "./amazon-reviews-handler";
import { handleSeoReviewHttpRequest } from "./seo-review-handler";
import { handleReviewImageHttpRequest } from "./review-image-handler";
import {
  handlePinterestPodDirectShopifySyncHttpRequest,
  handlePinterestPodSeoHttpRequest,
} from "./pinterest-pod-handler";
import { assertHostSecurity, createGatewayHttpHandler, isGatewayAuthorized, isSameOriginRequest, MAX_BODY_BYTES } from "./http-server";
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
      const isMockMode =
        server?.config?.mode === "mock" ||
        process.env.VITE_APP_ENV === "mock" ||
        process.env.APP_ENV === "mock";

      const storeConfigFile = env.GATEWAY_STORES_FILE?.trim() || ".runtime/stores.local.json";
      const stores = loadBootstrappedStores({ env, configFile: storeConfigFile });

      const storeRegistry = new InMemoryStoreRegistry(stores);
      const tokenProvider = new CompositeTokenProvider();
      const throttleManager = new InMemoryThrottleManager();
      const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
      const idempotencyStore = new InMemoryIdempotencyStore();
      const dispatcher = new GatewayDispatcher({ storeRegistry, graphqlClient, idempotencyStore });
      const httpHandler = createGatewayHttpHandler(dispatcher, { authToken, maxBodyBytes });
      const storeControlPlane = new StoreControlPlane({
        storeRegistry,
        tokenProvider,
        graphqlClient,
        persistConfigFile: storeConfigFile,
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/api/review-images/")) {
          if (authToken && isSameOriginRequest(req.headers) && !req.headers["x-gateway-key"] && !req.headers["authorization"]) {
            req.headers["x-gateway-key"] = authToken;
          }
          await handleReviewImageHttpRequest(req, res, {
            authToken,
            bridgeToken: env.REVIEW_IMAGE_BRIDGE_TOKEN || process.env.REVIEW_IMAGE_BRIDGE_TOKEN || "change-this-token",
            dispatcher,
          });
          return;
        }
        if (req.url === "/mcp/gpt-seo" || req.url?.startsWith("/mcp/gpt-seo?")) {
          await getCustomGptRuntime().mcpHandler(req, res);
          return;
        }
        if (req.url?.startsWith("/api/v1/gpt-seo/")) {
          if (req.url.startsWith("/api/v1/gpt-seo/admin/") && authToken && isSameOriginRequest(req.headers)) {
            req.headers["x-gateway-key"] = authToken;
          }
          await getCustomGptRuntime().handler(req, res);
          return;
        }
        const isShopify = req.url && (req.url === "/api/shopify" || req.url.startsWith("/api/shopify?"));
        const isAutoSeoRun = req.url && (req.url === "/api/auto-seo/run" || req.url.startsWith("/api/auto-seo/run?"));
        const isAmazonReviews = req.url === "/api/amazon-reviews/samples";
        const isAutoSeoEligibility = req.url && (req.url === "/api/auto-seo/eligibility" || req.url.startsWith("/api/auto-seo/eligibility?"));
        const isAutoSeo = isAutoSeoRun || isAutoSeoEligibility;
        const isPinterestPodHandover = req.url && (req.url === "/api/pinterest-pod/handover-seo" || req.url.startsWith("/api/pinterest-pod/handover-seo?"));
        const isPinterestPodDirectSync = req.url && (req.url === "/api/pinterest-pod/sync-shopify" || req.url.startsWith("/api/pinterest-pod/sync-shopify?"));
        const isStoreRegister = req.url && (req.url === "/api/stores/register" || req.url.startsWith("/api/stores/register?"));
        const isStoreUpdate = req.url && (req.url === "/api/stores/update" || req.url.startsWith("/api/stores/update?"));
        const isStoreDelete = req.url && (req.url === "/api/stores/delete" || req.url.startsWith("/api/stores/delete?"));
        const isStoreGet = req.url && (req.url === "/api/stores/get" || req.url.startsWith("/api/stores/get?"));
        const isProxyCheck = req.url && (req.url === "/api/proxy/check" || req.url.startsWith("/api/proxy/check?"));

        const isKnownApi = req.url?.startsWith("/api/ads-intelligence/") || isShopify || isAutoSeo || isAmazonReviews || isPinterestPodHandover || isPinterestPodDirectSync || isStoreRegister || isStoreUpdate || isStoreDelete || isStoreGet || isProxyCheck;

        if (authToken && isKnownApi && isSameOriginRequest(req.headers)) {
          if (!req.headers["x-gateway-key"]) {
            req.headers["x-gateway-key"] = authToken;
          }
        }

        if (isShopify || isAutoSeo || isStoreRegister || isStoreUpdate || isStoreDelete || isStoreGet) {
          try {
            const freshStores = loadBootstrappedStores({ env: loadLocalEnv(), configFile: storeConfigFile });
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
            // non-fatal env sync in dev
          }
        }

        if (isAmazonReviews) {
          await handleAmazonReviewsHttpRequest(req, res, { authToken, maxBodyBytes });
          return;
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
        } else if (isStoreRegister) {
          await handleStoreRegistrationHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
        } else if (isStoreUpdate) {
          await handleStoreUpdateHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
        } else if (isStoreDelete) {
          await handleStoreDeleteHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
        } else if (isStoreGet) {
          await handleStoreGetHttpRequest(req, res, storeControlPlane, { authToken, maxBodyBytes });
        } else if (isProxyCheck) {
          await handleProxyCheckHttpRequest(req, res, { authToken, maxBodyBytes });
        } else if (isAutoSeo) {
          if (isMockMode) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: {
                  code: "AUTO_SEO_MOCK_MODE_RESTRICTION",
                  message: "Auto SEO real backend pipeline is disabled in mock mode.",
                },
              }),
            );
            return;
          }
          if (isAutoSeoEligibility) {
            await handleAutoSeoEligibilityHttpRequest(req, res, { authToken, maxBodyBytes });
          } else {
            await handleAutoSeoHttpRequest(req, res, { authToken, maxBodyBytes });
          }
        } else if (isPinterestPodHandover) {
          await handlePinterestPodSeoHttpRequest(req, res, { authToken, maxBodyBytes });
        } else if (isPinterestPodDirectSync) {
          await handlePinterestPodDirectShopifySyncHttpRequest(req, res, { authToken, maxBodyBytes, dispatcher });
        } else if (req.url && (req.url === "/api/seo-review/items" || req.url.startsWith("/api/seo-review/"))) {
          if (authToken && isSameOriginRequest(req.headers) && !req.headers["x-gateway-key"] && !req.headers["authorization"]) {
            req.headers["x-gateway-key"] = authToken;
          }
          await handleSeoReviewHttpRequest(req, res, { authToken, maxBodyBytes });
        } else {
          next();
        }
      });
    },
  };
}
