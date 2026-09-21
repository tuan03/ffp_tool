import type { GatewayErrorCode, GraphQLCostExtension, GraphQLErrorItem } from "./types";

export function sanitizeErrorMessage(message: unknown, fallback = "Shopify gateway error"): string {
  if (typeof message !== "string" || message.trim() === "") {
    return fallback;
  }
  let sanitized = message.trim();

  // Strip user:password from URLs: http(s)://user:pass@host -> http(s)://***:***@host
  sanitized = sanitized.replace(/(https?:\/\/)([^/\s:@]+):([^/\s:@]+)@/gi, "$1***:***@");

  const lower = sanitized.toLowerCase();
  if (
    lower.includes("bearer") ||
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("password") ||
    lower.includes("authorization") ||
    lower.includes("credential") ||
    lower.includes("api_key") ||
    lower.includes("apikey") ||
    lower.includes("private_key") ||
    lower.includes("shpat_") ||
    lower.includes("shpca_") ||
    lower.includes("shppa_")
  ) {
    return fallback;
  }

  // Prevent stack traces and system error leaks
  if (
    /\n\s*at\s+/.test(sanitized) ||
    /\bat\s+\S+:\d+/.test(sanitized) ||
    /\bnode:\S+/.test(sanitized) ||
    /^[A-Z][a-zA-Z0-9_$]*Error:/.test(sanitized) ||
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|EPIPE|ESOCKETTIMEDOUT)\b/.test(sanitized) ||
    /\b\S+\.(?:js|ts|mjs|cjs):\d+/.test(sanitized)
  ) {
    return fallback;
  }

  return sanitized;
}

export class GatewayError extends Error {
  public constructor(
    message: string,
    public readonly code: GatewayErrorCode,
    public readonly httpStatus: number,
    public readonly retryAfterSeconds?: number,
    public readonly cause?: unknown,
  ) {
    super(sanitizeErrorMessage(message, "Shopify gateway error"));
    this.name = "GatewayError";
  }
}

export function mapGraphqlErrorsToGatewayError(
  errors: readonly GraphQLErrorItem[],
  cost?: GraphQLCostExtension,
): GatewayError {
  if (errors.length === 0) {
    return new GatewayError("Unknown GraphQL error", "SHOPIFY_USER_ERROR", 400);
  }

  const isThrottled = errors.some(
    (e) => e.extensions?.code === "THROTTLED" || e.message.toLowerCase().includes("throttled"),
  );
  if (isThrottled) {
    let retryAfterSeconds = 2;
    if (cost?.throttleStatus && cost.requestedQueryCost !== undefined) {
      const deficit = cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable;
      if (deficit > 0 && cost.throttleStatus.restoreRate > 0) {
        retryAfterSeconds = Math.max(1, Math.ceil(deficit / cost.throttleStatus.restoreRate));
      }
    }
    return new GatewayError(
      "Shopify GraphQL request was throttled",
      "SHOPIFY_THROTTLED",
      429,
      retryAfterSeconds,
    );
  }

  const isAccessDenied = errors.some(
    (e) =>
      e.extensions?.code === "ACCESS_DENIED" ||
      e.message.toLowerCase().includes("access denied") ||
      e.message.toLowerCase().includes("permission"),
  );
  if (isAccessDenied) {
    return new GatewayError("Access denied for requested Shopify resource", "SHOPIFY_PERMISSION_DENIED", 403);
  }

  const isAuthFailed = errors.some(
    (e) =>
      e.extensions?.code === "UNAUTHORIZED" ||
      e.message.toLowerCase().includes("unauthorized") ||
      e.message.toLowerCase().includes("invalid api key"),
  );
  if (isAuthFailed) {
    return new GatewayError("Shopify authentication failed", "SHOPIFY_AUTH_FAILED", 401);
  }

  const combinedMessage = errors.map((e) => e.message).join("; ");
  return new GatewayError(combinedMessage, "SHOPIFY_USER_ERROR", 400);
}
