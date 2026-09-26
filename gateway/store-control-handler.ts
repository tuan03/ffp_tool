import type http from "node:http";

import { GatewayError } from "./errors";
import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { checkProxyConnection } from "./proxy-transport";
import type { StoreControlPlane, RegisterStoreInput, UpdateStoreCredentialsInput, StoreAuthInput } from "./store-control-plane";
import type { StoreProxyConfig } from "./types";

export interface StoreControlHandlerOptions {
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

export async function handleStoreRegistrationHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  controlPlane: StoreControlPlane,
  options?: StoreControlHandlerOptions,
): Promise<void> {
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;
  const authToken = options?.authToken;

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

  let body: unknown;
  try {
    const raw = Buffer.concat(chunks).toString("utf-8");
    body = JSON.parse(raw || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Invalid JSON payload" },
      }),
    );
    return;
  }

  if (!body || typeof body !== "object") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Payload must be an object" },
      }),
    );
    return;
  }

  const rec = body as Record<string, unknown>;
  const storeId = typeof rec.storeId === "string" ? rec.storeId.trim() : "";
  const rawDomain = typeof rec.shopDomain === "string" ? rec.shopDomain.trim() : "";

  if (!storeId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "storeId is required" },
      }),
    );
    return;
  }

  if (!rawDomain) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "shopDomain is required" },
      }),
    );
    return;
  }

  // Parse Auth
  let auth: StoreAuthInput | undefined;
  if (rec.auth && typeof rec.auth === "object") {
    const authRec = rec.auth as Record<string, unknown>;
    if (authRec.type === "static_access_token" || authRec.type === "static") {
      auth = {
        type: "static_access_token",
        accessToken: String(authRec.accessToken || authRec.staticToken || "").trim(),
      };
    } else if (authRec.type === "client_credentials") {
      auth = {
        type: "client_credentials",
        clientId: String(authRec.clientId || "").trim(),
        clientSecret: String(authRec.clientSecret || "").trim(),
      };
    }
  } else if (rec.clientId && rec.clientSecret) {
    auth = {
      type: "client_credentials",
      clientId: String(rec.clientId).trim(),
      clientSecret: String(rec.clientSecret).trim(),
    };
  } else if (rec.accessToken || rec.staticToken) {
    auth = {
      type: "static_access_token",
      accessToken: String(rec.accessToken || rec.staticToken).trim(),
    };
  }

  if (!auth) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: "SHOPIFY_INVALID_INPUT",
          message: "Authentication credentials required (either clientId/clientSecret or accessToken)",
        },
      }),
    );
    return;
  }

  // Parse Proxy (optional)
  let proxy: StoreProxyConfig | undefined;
  if (rec.proxy && typeof rec.proxy === "object") {
    const pRec = rec.proxy as Record<string, unknown>;
    const pUrl = String(pRec.url || "").trim();
    if (pUrl) {
      proxy = {
        url: pUrl,
        username: pRec.username ? String(pRec.username).trim() : undefined,
        password: pRec.password ? String(pRec.password).trim() : undefined,
        failClosed: pRec.failClosed !== false,
      };
    }
  } else if (typeof rec.proxyUrl === "string" && rec.proxyUrl.trim() !== "") {
    proxy = {
      url: rec.proxyUrl.trim(),
      username: rec.proxyUsername ? String(rec.proxyUsername).trim() : undefined,
      password: rec.proxyPassword ? String(rec.proxyPassword).trim() : undefined,
      failClosed: true,
    };
  }

  const apiVersion =
    typeof rec.apiVersion === "string" && rec.apiVersion.trim() !== ""
      ? rec.apiVersion.trim()
      : "2026-07";

  const rawProductTypes = rec.productTypes ?? rec.product_types;
  const productTypes = Array.isArray(rawProductTypes)
    ? rawProductTypes.map((t) => String(t).trim()).filter(Boolean)
    : typeof rawProductTypes === "string"
    ? rawProductTypes.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const rawDefaultType = rec.defaultProductType ?? rec.default_product_type;
  const defaultProductType =
    typeof rawDefaultType === "string" && rawDefaultType.trim()
      ? rawDefaultType.trim()
      : undefined;

  const registrationInput: RegisterStoreInput = {
    storeId,
    shopDomain: rawDomain,
    apiVersion,
    auth,
    proxy,
    skipVerify: rec.skipVerify === true,
    productTypes: productTypes && productTypes.length > 0 ? productTypes : undefined,
    defaultProductType,
  };

  try {
    if (rec.testOnly === true || rec.dryRun === true) {
      const testResult = await controlPlane.testStoreConnection(registrationInput);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: true,
          data: testResult,
        }),
      );
      return;
    }

    const result = await controlPlane.registerStore(registrationInput);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: result,
      }),
    );
  } catch (caught: unknown) {
    const status = caught instanceof GatewayError ? caught.httpStatus : 500;
    const code = caught instanceof GatewayError ? caught.code : "SHOPIFY_AUTH_FAILED";
    const message = caught instanceof Error ? caught.message : "Failed to register store";

    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code, message },
      }),
    );
  }
}

export async function handleProxyCheckHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: StoreControlHandlerOptions,
): Promise<void> {
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;
  const authToken = options?.authToken;

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

  let body: unknown;
  try {
    const raw = Buffer.concat(chunks).toString("utf-8");
    body = JSON.parse(raw || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Invalid JSON payload" },
      }),
    );
    return;
  }

  const rec = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const url = String(rec.url || rec.proxyUrl || "").trim();
  const username = typeof rec.username === "string" ? rec.username.trim() : (typeof rec.proxyUsername === "string" ? rec.proxyUsername.trim() : undefined);
  const password = typeof rec.password === "string" ? rec.password.trim() : (typeof rec.proxyPassword === "string" ? rec.proxyPassword.trim() : undefined);

  if (!url) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Proxy URL is required" },
      }),
    );
    return;
  }

  try {
    const checkResult = await checkProxyConnection({ url, username, password });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: checkResult.success,
        data: checkResult,
        error: checkResult.success ? undefined : { code: "PROXY_CHECK_FAILED", message: checkResult.error },
      }),
    );
  } catch (err: unknown) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: "SHOPIFY_NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Proxy check failed",
        },
      }),
    );
  }
}

export async function handleStoreUpdateHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  controlPlane: StoreControlPlane,
  options?: StoreControlHandlerOptions,
): Promise<void> {
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;
  const authToken = options?.authToken;

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

  let body: unknown;
  try {
    const raw = Buffer.concat(chunks).toString("utf-8");
    body = JSON.parse(raw || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Invalid JSON payload" },
      }),
    );
    return;
  }

  if (!body || typeof body !== "object") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Payload must be an object" },
      }),
    );
    return;
  }

  const rec = body as Record<string, unknown>;
  const storeId = typeof rec.storeId === "string" ? rec.storeId.trim() : "";
  if (!storeId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "storeId is required" },
      }),
    );
    return;
  }

  const rawDomain = typeof rec.shopDomain === "string" ? rec.shopDomain.trim() : undefined;

  // Parse Auth (optional on update)
  let auth: StoreAuthInput | undefined;
  if (rec.auth && typeof rec.auth === "object") {
    const authRec = rec.auth as Record<string, unknown>;
    if (authRec.type === "static_access_token" || authRec.type === "static") {
      auth = {
        type: "static_access_token",
        accessToken: String(authRec.accessToken || authRec.staticToken || "").trim(),
      };
    } else if (authRec.type === "client_credentials") {
      auth = {
        type: "client_credentials",
        clientId: String(authRec.clientId || "").trim(),
        clientSecret: String(authRec.clientSecret || "").trim(),
      };
    }
  } else if (rec.clientId || rec.clientSecret) {
    auth = {
      type: "client_credentials",
      clientId: String(rec.clientId || "").trim(),
      clientSecret: String(rec.clientSecret || "").trim(),
    };
  } else if (rec.accessToken || rec.staticToken) {
    auth = {
      type: "static_access_token",
      accessToken: String(rec.accessToken || rec.staticToken || "").trim(),
    };
  }

  // Parse Proxy (optional, null to disable)
  let proxy: StoreProxyConfig | null | undefined;
  if (rec.proxy === null || rec.enableProxy === false) {
    proxy = null;
  } else if (rec.proxy && typeof rec.proxy === "object") {
    const pObj = rec.proxy as Record<string, unknown>;
    const pUrl = String(pObj.url || pObj.server || "").trim();
    if (pUrl) {
      proxy = {
        url: pUrl,
        username: typeof pObj.username === "string" && pObj.username.trim() ? pObj.username.trim() : undefined,
        password: typeof pObj.password === "string" && pObj.password.trim() ? pObj.password.trim() : undefined,
        failClosed: pObj.failClosed !== false,
      };
    }
  } else if (typeof rec.proxyUrl === "string" && rec.proxyUrl.trim()) {
    proxy = {
      url: rec.proxyUrl.trim(),
      username: typeof rec.proxyUsername === "string" && rec.proxyUsername.trim() ? rec.proxyUsername.trim() : undefined,
      password: typeof rec.proxyPassword === "string" && rec.proxyPassword.trim() ? rec.proxyPassword.trim() : undefined,
      failClosed: rec.proxyFailClosed !== false,
    };
  }

  const rawApiVersion = typeof rec.apiVersion === "string" ? rec.apiVersion.trim() : undefined;
  const rawProductTypes = rec.productTypes ?? rec.product_types;
  const productTypes = Array.isArray(rawProductTypes)
    ? rawProductTypes.map((t) => String(t).trim()).filter(Boolean)
    : typeof rawProductTypes === "string"
    ? rawProductTypes.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const rawDefaultType = rec.defaultProductType ?? rec.default_product_type;
  const defaultProductType =
    typeof rawDefaultType === "string" && rawDefaultType.trim() ? rawDefaultType.trim() : undefined;

  const updateInput: UpdateStoreCredentialsInput = {
    storeId,
    shopDomain: rawDomain,
    apiVersion: rawApiVersion,
    auth,
    proxy,
    skipVerify: rec.skipVerify === true,
    productTypes,
    defaultProductType,
  };

  try {
    if (rec.testOnly === true || rec.dryRun === true) {
      const testResult = await controlPlane.testStoreConnection(updateInput);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: true,
          data: testResult,
        }),
      );
      return;
    }

    const result = await controlPlane.updateStoreCredentials(updateInput);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: result,
      }),
    );
  } catch (caught: unknown) {
    const status = caught instanceof GatewayError ? caught.httpStatus : 500;
    const code = caught instanceof GatewayError ? caught.code : "SHOPIFY_AUTH_FAILED";
    const message = caught instanceof Error ? caught.message : "Failed to update store";

    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code, message },
      }),
    );
  }
}

export async function handleStoreDeleteHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  controlPlane: StoreControlPlane,
  options?: StoreControlHandlerOptions,
): Promise<void> {
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;
  const authToken = options?.authToken;

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

  let body: unknown;
  try {
    const raw = Buffer.concat(chunks).toString("utf-8");
    body = JSON.parse(raw || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "Invalid JSON payload" },
      }),
    );
    return;
  }

  const rec = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const storeId = typeof rec.storeId === "string" ? rec.storeId.trim() : "";

  if (!storeId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "storeId is required" },
      }),
    );
    return;
  }

  try {
    const result = await controlPlane.disconnectStore(storeId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: result,
      }),
    );
  } catch (caught: unknown) {
    const status = caught instanceof GatewayError ? caught.httpStatus : 500;
    const code = caught instanceof GatewayError ? caught.code : "SHOPIFY_NOT_FOUND";
    const message = caught instanceof Error ? caught.message : "Failed to delete store";

    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code, message },
      }),
    );
  }
}

export async function handleStoreGetHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  controlPlane: StoreControlPlane,
  options?: StoreControlHandlerOptions,
): Promise<void> {
  const authToken = options?.authToken;

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

  let storeId = "";
  try {
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    storeId = parsedUrl.searchParams.get("storeId") || "";
  } catch {}

  if (!storeId && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    try {
      const raw = Buffer.concat(chunks).toString("utf-8");
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && typeof parsed.storeId === "string") {
        storeId = parsed.storeId.trim();
      }
    } catch {}
  }

  if (!storeId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_INVALID_INPUT", message: "storeId is required" },
      }),
    );
    return;
  }

  try {
    const result = await controlPlane.getStore(storeId);
    if (!result.store) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_NOT_FOUND", message: `Store not found: ${storeId}` },
        }),
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: result,
      }),
    );
  } catch (caught: unknown) {
    const status = caught instanceof GatewayError ? caught.httpStatus : 500;
    const code = caught instanceof GatewayError ? caught.code : "SHOPIFY_NOT_FOUND";
    const message = caught instanceof Error ? caught.message : "Failed to get store";

    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code, message },
      }),
    );
  }
}

