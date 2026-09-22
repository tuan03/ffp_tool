import crypto from "node:crypto";

import { GatewayError } from "./errors";
import type { GatewayDispatcher } from "./dispatcher";
import type { GatewayRequest } from "./types";

export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB

export interface GatewayHttpHandlerOptions {
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

export function isGatewayAuthorized(
  headers: Headers | Record<string, string | string[] | undefined>,
  configuredToken?: string,
): boolean {
  if (!configuredToken) {
    return true;
  }
  const cleanConfigured = configuredToken.trim();
  if (!cleanConfigured) {
    return true;
  }

  let gatewayKey: string | undefined;
  let authHeader: string | undefined;

  if (typeof (headers as Headers).get === "function") {
    gatewayKey = (headers as Headers).get("X-Gateway-Key")?.trim();
    authHeader = (headers as Headers).get("Authorization")?.trim();
  } else {
    const rec = headers as Record<string, string | string[] | undefined>;
    const rawKey = rec["x-gateway-key"] ?? rec["X-Gateway-Key"];
    gatewayKey = (Array.isArray(rawKey) ? rawKey[0] : rawKey)?.trim();
    const rawAuth = rec["authorization"] ?? rec["Authorization"];
    authHeader = (Array.isArray(rawAuth) ? rawAuth[0] : rawAuth)?.trim();
  }

  let bearerToken: string | undefined;
  if (authHeader) {
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      bearerToken = authHeader.slice(7).trim();
    } else {
      bearerToken = authHeader;
    }
  }

  const tokenBuf = Buffer.from(cleanConfigured);
  const checkMatch = (candidate?: string): boolean => {
    if (!candidate) {
      return false;
    }
    const candBuf = Buffer.from(candidate);
    if (candBuf.length !== tokenBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(candBuf, tokenBuf);
  };

  return checkMatch(gatewayKey) || checkMatch(bearerToken);
}

export function createGatewayHttpHandler(
  dispatcher: GatewayDispatcher,
  options?: GatewayHttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const configuredToken = (
    options?.authToken ??
    (typeof process !== "undefined" && process.env ? process.env.GATEWAY_AUTH_TOKEN : undefined)
  )?.trim();
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_INVALID_INPUT", message: "Method Not Allowed" },
        }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    if (configuredToken && !isGatewayAuthorized(request.headers, configuredToken)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "SHOPIFY_AUTH_FAILED",
            message: "Unauthorized: Invalid or missing Gateway authentication token",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const cl = Number.parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(cl) && cl > maxBodyBytes) {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "SHOPIFY_INVALID_INPUT",
              message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
            },
          }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    let rawText: string;
    try {
      rawText = await request.text();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_INVALID_INPUT", message: "Failed to read request body" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const actualByteLength =
      typeof Buffer !== "undefined"
        ? Buffer.byteLength(rawText, "utf8")
        : new TextEncoder().encode(rawText).length;

    if (actualByteLength > maxBodyBytes) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "SHOPIFY_INVALID_INPUT",
            message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
          },
        }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_INVALID_INPUT", message: "Malformed JSON body" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const response = await dispatcher.dispatch(body as GatewayRequest);
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      if (err instanceof GatewayError) {
        return new Response(
          JSON.stringify({
            storeId: (body as GatewayRequest)?.storeId ?? "",
            operation: (body as GatewayRequest)?.operation ?? "",
            success: false,
            error: {
              code: err.code,
              message: err.message,
              retryAfterSeconds: err.retryAfterSeconds,
              fields: err.fields,
              retryable: err.retryable,
              reconciliationRequired:
                err.reconciliationRequired || Boolean(err.details?.reconciliationRequired) || undefined,
              details: err.details,
            },
          }),
          {
            status: err.httpStatus,
            headers: {
              "Content-Type": "application/json",
              ...(err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : {}),
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_NETWORK_ERROR", message: "Internal Gateway Error" },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
