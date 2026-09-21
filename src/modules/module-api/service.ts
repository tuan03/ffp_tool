import type {
  ModuleApiConfig,
  ModuleApiDependencies,
  ModuleApiRunner,
  ShopifyApiErrorCode,
  ShopifyApiInput,
  ShopifyApiResponse,
  ShopifyCollectionsCreateInput,
  ShopifyCollectionsCreateResponse,
  ShopifyCollectionsDeleteInput,
  ShopifyCollectionsDeleteResponse,
  ShopifyCollectionsGetInput,
  ShopifyCollectionsGetResponse,
  ShopifyCollectionsListInput,
  ShopifyCollectionsListResponse,
  ShopifyCollectionsUpdateInput,
  ShopifyCollectionsUpdateMembershipInput,
  ShopifyCollectionsUpdateMembershipResponse,
  ShopifyCollectionsUpdateResponse,
  ShopifyConnectionTestInput,
  ShopifyConnectionTestResponse,
  ShopifyOperation,
  ShopifyProductsBulkUpdateInput,
  ShopifyProductsBulkUpdateResponse,
  ShopifyProductsCreateInput,
  ShopifyProductsCreateResponse,
  ShopifyProductsDeleteInput,
  ShopifyProductsDeleteResponse,
  ShopifyProductsGetInput,
  ShopifyProductsGetResponse,
  ShopifyProductsListInput,
  ShopifyProductsListResponse,
  ShopifyProductsUpdateInput,
  ShopifyProductsUpdateResponse,
  ShopifyVariantsBulkUpdateInput,
  ShopifyVariantsBulkUpdateResponse,
  ShopifyVariantsUpdateInput,
  ShopifyVariantsUpdateResponse,
} from "./types";
import { ShopifyApiError } from "./types";

export const DEFAULT_GATEWAY_URL = "/api/shopify";

const READ_OPERATIONS: ReadonlySet<ShopifyOperation> = new Set([
  "connection.test",
  "products.list",
  "products.get",
  "collections.list",
  "collections.get",
]);

const ALL_OPERATIONS: ReadonlySet<ShopifyOperation> = new Set([
  "connection.test",
  "products.list",
  "products.get",
  "products.create",
  "products.update",
  "products.bulkUpdate",
  "products.delete",
  "variants.update",
  "variants.bulkUpdate",
  "collections.list",
  "collections.get",
  "collections.create",
  "collections.update",
  "collections.delete",
  "collections.updateMembership",
]);

function isShopifyReadOperation(operation: ShopifyOperation): boolean {
  return READ_OPERATIONS.has(operation);
}

const VALID_ERROR_CODES: ReadonlySet<string> = new Set([
  "SHOPIFY_AUTH_FAILED",
  "SHOPIFY_THROTTLED",
  "SHOPIFY_USER_ERROR",
  "SHOPIFY_NETWORK_ERROR",
  "SHOPIFY_UNKNOWN_WRITE_STATE",
]);

function normalizeErrorCode(value: unknown): ShopifyApiErrorCode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const upper = value.trim().toUpperCase();
  if (VALID_ERROR_CODES.has(upper)) {
    return upper as ShopifyApiErrorCode;
  }
  if (
    upper === "AUTH_FAILED" ||
    upper === "UNAUTHORIZED" ||
    upper === "FORBIDDEN" ||
    upper === "INVALID_CREDENTIALS" ||
    upper === "ACCESS_DENIED"
  ) {
    return "SHOPIFY_AUTH_FAILED";
  }
  if (
    upper === "THROTTLED" ||
    upper === "RATE_LIMITED" ||
    upper === "TOO_MANY_REQUESTS" ||
    upper === "QUERY_COST_EXCEEDED"
  ) {
    return "SHOPIFY_THROTTLED";
  }
  if (
    upper === "USER_ERROR" ||
    upper === "BAD_REQUEST" ||
    upper === "NOT_FOUND" ||
    upper === "UNPROCESSABLE_ENTITY" ||
    upper === "VALIDATION_ERROR"
  ) {
    return "SHOPIFY_USER_ERROR";
  }
  if (upper === "NETWORK_ERROR" || upper === "GATEWAY_ERROR" || upper === "BAD_GATEWAY") {
    return "SHOPIFY_NETWORK_ERROR";
  }
  if (upper === "UNKNOWN_WRITE_STATE" || upper === "AMBIGUOUS_WRITE") {
    return "SHOPIFY_UNKNOWN_WRITE_STATE";
  }
  return undefined;
}

function sanitizeErrorMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string" || message.trim() === "") {
    return fallback;
  }

  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Prevent credential leakage or tokens in error messages
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

  // Prevent raw system exceptions and stack traces in error messages
  if (
    /\n\s*at\s+/.test(trimmed) ||
    /\bat\s+\S+:\d+/.test(trimmed) ||
    /\bnode:\S+/.test(trimmed) ||
    /^[A-Z][a-zA-Z0-9_$]*Error:/.test(trimmed) ||
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|EPIPE|ESOCKETTIMEDOUT)\b/.test(trimmed) ||
    /\b\S+\.(?:js|ts|mjs|cjs):\d+/.test(trimmed)
  ) {
    return fallback;
  }

  return trimmed;
}

interface ExtractedError {
  readonly code?: ShopifyApiErrorCode;
  readonly message?: string;
}

function extractErrorFromPayload(payload: unknown): ExtractedError {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const obj = payload as Record<string, unknown>;
  let code: ShopifyApiErrorCode | undefined;
  let message: string | undefined;

  if (obj.code !== undefined) {
    code = normalizeErrorCode(obj.code);
  }

  if (typeof obj.message === "string") {
    message = obj.message;
  }

  if ("error" in obj && obj.error !== undefined && obj.error !== null) {
    if (typeof obj.error === "string") {
      message = message ?? obj.error;
    } else if (typeof obj.error === "object") {
      const errObj = obj.error as Record<string, unknown>;
      if (errObj.code !== undefined) {
        code = code ?? normalizeErrorCode(errObj.code);
      }
      if (typeof errObj.message === "string") {
        message = message ?? errObj.message;
      }
    }
  }

  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    const messages: string[] = [];
    for (const item of obj.errors) {
      if (typeof item === "string") {
        messages.push(item);
      } else if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        if (!code && itemObj.code !== undefined) {
          code = normalizeErrorCode(itemObj.code);
        }
        if (typeof itemObj.message === "string") {
          messages.push(itemObj.message);
        }
      }
    }
    if (messages.length > 0) {
      message = message ?? messages.join("; ");
    }
  }

  return { code, message };
}

function mapStatusToErrorCode(
  status: number,
  isRead: boolean,
  bodyCode?: ShopifyApiErrorCode,
): ShopifyApiErrorCode {
  if (bodyCode) {
    return bodyCode;
  }

  if (status === 401 || status === 403) {
    return "SHOPIFY_AUTH_FAILED";
  }

  if (status === 429) {
    return "SHOPIFY_THROTTLED";
  }

  // 408 Request Timeout and 499 Client Closed Request
  if (status === 408 || status === 499) {
    return isRead ? "SHOPIFY_NETWORK_ERROR" : "SHOPIFY_UNKNOWN_WRITE_STATE";
  }

  if (status >= 400 && status < 500) {
    return "SHOPIFY_USER_ERROR";
  }

  if (status >= 500) {
    return isRead ? "SHOPIFY_NETWORK_ERROR" : "SHOPIFY_UNKNOWN_WRITE_STATE";
  }

  return isRead ? "SHOPIFY_NETWORK_ERROR" : "SHOPIFY_UNKNOWN_WRITE_STATE";
}

export function createModuleApiRunner(
  config?: ModuleApiConfig,
  dependencies?: ModuleApiDependencies,
): ModuleApiRunner {
  const gatewayUrl = config?.gatewayUrl ?? DEFAULT_GATEWAY_URL;

  const runner = async (input: ShopifyApiInput): Promise<ShopifyApiResponse> => {
    if (!input || typeof input !== "object") {
      throw new ShopifyApiError("Input must be a valid object", "SHOPIFY_USER_ERROR");
    }

    if (!input.storeId || input.storeId.trim() === "") {
      throw new ShopifyApiError("Store ID is required", "SHOPIFY_USER_ERROR");
    }

    if (!input.operation || typeof input.operation !== "string") {
      throw new ShopifyApiError("Operation is required", "SHOPIFY_USER_ERROR");
    }

    if (!ALL_OPERATIONS.has(input.operation as ShopifyOperation)) {
      throw new ShopifyApiError(
        `Unsupported Shopify operation: ${input.operation}`,
        "SHOPIFY_USER_ERROR",
      );
    }

    if (!input.payload || typeof input.payload !== "object") {
      throw new ShopifyApiError("Payload is required", "SHOPIFY_USER_ERROR");
    }

    const invokeFetch = (url: string, init?: RequestInit): Promise<Response> => {
      if (dependencies?.fetch) {
        return dependencies.fetch(url, init);
      }
      if (typeof globalThis.fetch === "function") {
        return globalThis.fetch(url, init);
      }
      throw new ShopifyApiError(
        "Fetch API is not available in current runtime environment",
        "SHOPIFY_NETWORK_ERROR",
      );
    };

    const isRead = isShopifyReadOperation(input.operation);

    const requestBody: Record<string, unknown> = {
      storeId: input.storeId,
      operation: input.operation,
      payload: input.payload,
    };

    if (input.requestId !== undefined && input.requestId.trim() !== "") {
      requestBody.requestId = input.requestId;
    }

    if ("mode" in input && input.mode !== undefined) {
      requestBody.mode = input.mode;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (input.requestId !== undefined && input.requestId.trim() !== "") {
      headers["X-Request-Id"] = input.requestId;
    }

    let abortController: AbortController | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (typeof config?.timeoutMs === "number" && config.timeoutMs > 0) {
      abortController = new AbortController();
      timeoutId = setTimeout(() => {
        abortController?.abort();
      }, config.timeoutMs);
    }

    let response: Response;
    try {
      response = await invokeFetch(gatewayUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: abortController?.signal,
      });
    } catch (networkError: unknown) {
      if (abortController?.signal.aborted) {
        if (isRead) {
          throw new ShopifyApiError(
            "Shopify gateway read request timed out",
            "SHOPIFY_NETWORK_ERROR",
            networkError,
          );
        }
        throw new ShopifyApiError(
          "Shopify gateway write request timed out; write state is ambiguous",
          "SHOPIFY_UNKNOWN_WRITE_STATE",
          networkError,
        );
      }

      if (isRead) {
        throw new ShopifyApiError(
          "Network request failed for Shopify read operation",
          "SHOPIFY_NETWORK_ERROR",
          networkError,
        );
      }
      throw new ShopifyApiError(
        "Network request failed for Shopify write operation; write state is ambiguous",
        "SHOPIFY_UNKNOWN_WRITE_STATE",
        networkError,
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    let responseJson: unknown;
    let jsonParseError: unknown;

    try {
      responseJson = await response.json();
    } catch (parseError: unknown) {
      jsonParseError = parseError;
    }

    if (!response.ok) {
      const { code: bodyCode, message: bodyMessage } = extractErrorFromPayload(responseJson);
      const errorCode = mapStatusToErrorCode(response.status, isRead, bodyCode);
      const fallbackMessage = `Shopify gateway request failed with status ${response.status}`;
      const errorMessage = sanitizeErrorMessage(bodyMessage, fallbackMessage);

      throw new ShopifyApiError(errorMessage, errorCode, jsonParseError);
    }

    if (jsonParseError !== undefined) {
      if (isRead) {
        throw new ShopifyApiError(
          "Failed to parse Shopify gateway response as JSON",
          "SHOPIFY_NETWORK_ERROR",
          jsonParseError,
        );
      }
      throw new ShopifyApiError(
        "Failed to parse Shopify gateway write response as JSON; write state is ambiguous",
        "SHOPIFY_UNKNOWN_WRITE_STATE",
        jsonParseError,
      );
    }

    if (!responseJson || typeof responseJson !== "object") {
      if (isRead) {
        throw new ShopifyApiError(
          "Invalid response format from Shopify gateway",
          "SHOPIFY_NETWORK_ERROR",
        );
      }
      throw new ShopifyApiError(
        "Invalid response format from Shopify gateway; write state is ambiguous",
        "SHOPIFY_UNKNOWN_WRITE_STATE",
      );
    }

    const parsedObj = responseJson as Record<string, unknown>;

    const hasData =
      "data" in parsedObj &&
      parsedObj.data !== undefined &&
      parsedObj.data !== null &&
      typeof parsedObj.data === "object";

    const hasExplicitError =
      parsedObj.success === false ||
      ("error" in parsedObj && parsedObj.error !== undefined && parsedObj.error !== null) ||
      (Array.isArray(parsedObj.errors) && parsedObj.errors.length > 0);

    if (parsedObj.success === false || (!hasData && hasExplicitError)) {
      const { code: bodyCode, message: bodyMessage } = extractErrorFromPayload(parsedObj);
      const errorCode = bodyCode ?? "SHOPIFY_USER_ERROR";
      const errorMessage = sanitizeErrorMessage(bodyMessage, "Shopify gateway operation failed");
      throw new ShopifyApiError(errorMessage, errorCode);
    }

    if (!hasData) {
      if (isRead) {
        throw new ShopifyApiError(
          "Shopify gateway response missing data payload",
          "SHOPIFY_NETWORK_ERROR",
        );
      }
      throw new ShopifyApiError(
        "Shopify gateway write response missing data payload; write state is ambiguous",
        "SHOPIFY_UNKNOWN_WRITE_STATE",
      );
    }

    return {
      storeId: typeof parsedObj.storeId === "string" ? parsedObj.storeId : input.storeId,
      operation: input.operation,
      success: true,
      data: parsedObj.data,
    } as unknown as ShopifyApiResponse;
  };

  return runner as ModuleApiRunner;
}

const defaultRunner = createModuleApiRunner();

/**
 * Executes real Shopify API operations via backend HTTP Gateway.
 */
export async function runModuleApi(input: ShopifyConnectionTestInput): Promise<ShopifyConnectionTestResponse>;
export async function runModuleApi(input: ShopifyProductsListInput): Promise<ShopifyProductsListResponse>;
export async function runModuleApi(input: ShopifyProductsGetInput): Promise<ShopifyProductsGetResponse>;
export async function runModuleApi(input: ShopifyProductsCreateInput): Promise<ShopifyProductsCreateResponse>;
export async function runModuleApi(input: ShopifyProductsUpdateInput): Promise<ShopifyProductsUpdateResponse>;
export async function runModuleApi(input: ShopifyProductsBulkUpdateInput): Promise<ShopifyProductsBulkUpdateResponse>;
export async function runModuleApi(input: ShopifyProductsDeleteInput): Promise<ShopifyProductsDeleteResponse>;
export async function runModuleApi(input: ShopifyVariantsUpdateInput): Promise<ShopifyVariantsUpdateResponse>;
export async function runModuleApi(input: ShopifyVariantsBulkUpdateInput): Promise<ShopifyVariantsBulkUpdateResponse>;
export async function runModuleApi(input: ShopifyCollectionsListInput): Promise<ShopifyCollectionsListResponse>;
export async function runModuleApi(input: ShopifyCollectionsGetInput): Promise<ShopifyCollectionsGetResponse>;
export async function runModuleApi(input: ShopifyCollectionsCreateInput): Promise<ShopifyCollectionsCreateResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateInput): Promise<ShopifyCollectionsUpdateResponse>;
export async function runModuleApi(input: ShopifyCollectionsDeleteInput): Promise<ShopifyCollectionsDeleteResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateMembershipInput): Promise<ShopifyCollectionsUpdateMembershipResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse> {
  return defaultRunner(input);
}
