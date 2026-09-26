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
  ShopifyFilesCreateInput,
  ShopifyFilesCreateResponse,
  ShopifyFilesBulkCreateInput,
  ShopifyFilesBulkCreateResponse,
  ShopifyFilesDeleteInput,
  ShopifyFilesDeleteResponse,
  ShopifyFilesListInput,
  ShopifyFilesListResponse,
  ShopifyMetafieldsSetInput,
  ShopifyMetafieldsSetResponse,
  ShopifyMetafieldsGetInput,
  ShopifyMetafieldsGetResponse,
  ShopifyMetafieldsDeleteInput,
  ShopifyMetafieldsDeleteResponse,
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
  ShopifyProductsPreflightAmazonAsinsInput,
  ShopifyProductsPreflightAmazonAsinsResponse,
  ShopifyProductsUpdateInput,
  ShopifyProductsUpdateResponse,
  ShopifyStoresGetInput,
  ShopifyStoresGetResponse,
  ShopifyStoresListInput,
  ShopifyStoresListResponse,
  ShopifyVariantsBulkCreateInput,
  ShopifyVariantsBulkCreateResponse,
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
  "metafields.get",
  "files.list",
  "collections.list",
  "collections.get",
  "stores.list",
  "stores.get",
]);

const ALL_OPERATIONS: ReadonlySet<ShopifyOperation> = new Set([
  "connection.test",
  "products.list",
  "products.get",
  "products.create",
  "products.update",
  "products.bulkUpdate",
  "products.delete",
  "products.preflightAmazonAsins",
  "variants.update",
  "variants.bulkUpdate",
  "variants.bulkCreate",
  "files.create",
  "files.bulkCreate",
  "files.stageBinary",
  "files.delete",
  "files.list",
  "metafields.set",
  "metafields.get",
  "metafields.delete",
  "collections.list",
  "collections.get",
  "collections.create",
  "collections.update",
  "collections.delete",
  "collections.updateMembership",
  "stores.list",
  "stores.get",
]);

export const SUPPORTED_SHOPIFY_OPERATIONS: ReadonlySet<ShopifyOperation> = ALL_OPERATIONS;

function isShopifyReadOperation(operation: ShopifyOperation): boolean {
  return READ_OPERATIONS.has(operation);
}

const VALID_ERROR_CODES: ReadonlySet<string> = new Set([
  "SHOPIFY_AUTH_FAILED",
  "SHOPIFY_THROTTLED",
  "SHOPIFY_USER_ERROR",
  "SHOPIFY_NETWORK_ERROR",
  "SHOPIFY_UNKNOWN_WRITE_STATE",
  "SHOPIFY_INVALID_INPUT",
  "SHOPIFY_NOT_FOUND",
  "SHOPIFY_PERMISSION_DENIED",
  "SHOPIFY_PARTIAL_WRITE",
  "NOT_IMPLEMENTED",
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
  if (upper === "PARTIAL_WRITE" || upper === "SHOPIFY_PARTIAL_WRITE") {
    return "SHOPIFY_PARTIAL_WRITE";
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
  readonly fields?: readonly string[];
  readonly retryable?: boolean;
  readonly details?: unknown;
  readonly reconciliationRequired?: boolean;
}

function extractErrorFromPayload(payload: unknown): ExtractedError {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const obj = payload as Record<string, unknown>;
  let code: ShopifyApiErrorCode | undefined;
  let message: string | undefined;
  let fields: readonly string[] | undefined;
  let retryable: boolean | undefined;
  let details: unknown | undefined;
  let reconciliationRequired: boolean | undefined;

  if (obj.code !== undefined) {
    code = normalizeErrorCode(obj.code);
  }

  if (typeof obj.message === "string") {
    message = obj.message;
  }

  if (Array.isArray(obj.fields)) {
    fields = obj.fields.map(String);
  }

  if (typeof obj.retryable === "boolean") {
    retryable = obj.retryable;
  }

  if (typeof obj.reconciliationRequired === "boolean") {
    reconciliationRequired = obj.reconciliationRequired;
  }

  if (obj.details !== undefined) {
    details = obj.details;
    if (reconciliationRequired === undefined && typeof obj.details === "object" && obj.details !== null) {
      const d = obj.details as Record<string, unknown>;
      if (typeof d.reconciliationRequired === "boolean") {
        reconciliationRequired = d.reconciliationRequired;
      }
    }
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
      if (Array.isArray(errObj.fields)) {
        fields = fields ?? errObj.fields.map(String);
      }
      if (typeof errObj.retryable === "boolean") {
        retryable = retryable ?? errObj.retryable;
      }
      if (typeof errObj.reconciliationRequired === "boolean") {
        reconciliationRequired = reconciliationRequired ?? errObj.reconciliationRequired;
      }
      if (errObj.details !== undefined) {
        details = details ?? errObj.details;
        if (reconciliationRequired === undefined && typeof errObj.details === "object" && errObj.details !== null) {
          const d = errObj.details as Record<string, unknown>;
          if (typeof d.reconciliationRequired === "boolean") {
            reconciliationRequired = d.reconciliationRequired;
          }
        }
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
        if (!fields && Array.isArray(itemObj.fields)) {
          fields = itemObj.fields.map(String);
        }
        if (retryable === undefined && typeof itemObj.retryable === "boolean") {
          retryable = itemObj.retryable;
        }
        if (reconciliationRequired === undefined && typeof itemObj.reconciliationRequired === "boolean") {
          reconciliationRequired = itemObj.reconciliationRequired;
        }
        if (details === undefined && itemObj.details !== undefined) {
          details = itemObj.details;
        }
      }
    }
    if (messages.length > 0) {
      message = message ?? messages.join("; ");
    }
  }

  return { code, message, fields, retryable, details, reconciliationRequired };
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

    if (!input.operation || typeof input.operation !== "string") {
      throw new ShopifyApiError("Operation is required", "SHOPIFY_USER_ERROR");
    }

    if (!ALL_OPERATIONS.has(input.operation as ShopifyOperation)) {
      throw new ShopifyApiError(
        `Unsupported Shopify operation: ${input.operation}`,
        "SHOPIFY_USER_ERROR",
      );
    }

    const effectivePayload =
      input.payload !== undefined && input.payload !== null
        ? input.payload
        : input.operation === "stores.list"
        ? {}
        : undefined;

    if (!effectivePayload || typeof effectivePayload !== "object") {
      throw new ShopifyApiError("Payload is required", "SHOPIFY_USER_ERROR");
    }

    if (input.operation === "stores.get") {
      const p = effectivePayload as Record<string, unknown>;
      const targetId = typeof p.targetStoreId === "string" ? p.targetStoreId.trim() : "";
      if (!targetId) {
        throw new ShopifyApiError("targetStoreId is required", "SHOPIFY_USER_ERROR");
      }
    }

    const payloadTargetId =
      effectivePayload && typeof effectivePayload === "object" && "targetStoreId" in effectivePayload
        ? (effectivePayload as { targetStoreId?: string }).targetStoreId
        : undefined;

    const effectiveStoreId =
      typeof input.storeId === "string" && input.storeId.trim() !== ""
        ? input.storeId.trim()
        : typeof payloadTargetId === "string" && payloadTargetId.trim() !== ""
        ? payloadTargetId.trim()
        : input.operation === "stores.list"
        ? "system"
        : "";

    if (!effectiveStoreId) {
      throw new ShopifyApiError("Store ID is required", "SHOPIFY_USER_ERROR");
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

    if (!isRead && "mode" in input && input.mode === "apply") {
      if (!input.requestId || input.requestId.trim() === "") {
        throw new ShopifyApiError(
          "requestId is required for write operations in apply mode",
          "SHOPIFY_USER_ERROR",
        );
      }
    }

    const requestBody: Record<string, unknown> = {
      operation: input.operation,
      payload: effectivePayload,
    };

    if (typeof input.storeId === "string" && input.storeId.trim() !== "") {
      requestBody.storeId = input.storeId.trim();
    }

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

    const authToken =
      config?.gatewayAuthToken ??
      (config as Record<string, unknown> | undefined)?.GATEWAY_AUTH_TOKEN as string | undefined ??
      (dependencies as Record<string, unknown> | undefined)?.gatewayAuthToken as string | undefined ??
      (dependencies as Record<string, unknown> | undefined)?.GATEWAY_AUTH_TOKEN as string | undefined ??
      (typeof process !== "undefined" && process.env ? process.env.GATEWAY_AUTH_TOKEN : undefined);

    if (authToken && typeof authToken === "string" && authToken.trim() !== "") {
      headers["X-Gateway-Key"] = authToken.trim();
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
      const {
        code: bodyCode,
        message: bodyMessage,
        fields,
        retryable,
        details,
        reconciliationRequired: bodyRecRequired,
      } = extractErrorFromPayload(responseJson);
      const errorCode = mapStatusToErrorCode(response.status, isRead, bodyCode);
      const fallbackMessage = `Shopify gateway request failed with status ${response.status}`;
      const errorMessage = sanitizeErrorMessage(bodyMessage, fallbackMessage);
      const reconciliationRequired =
        bodyRecRequired ??
        (errorCode === "SHOPIFY_PARTIAL_WRITE" || errorCode === "SHOPIFY_UNKNOWN_WRITE_STATE" ? true : undefined);

      throw new ShopifyApiError(errorMessage, errorCode, jsonParseError, fields, retryable, details, reconciliationRequired);
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
      const {
        code: bodyCode,
        message: bodyMessage,
        fields,
        retryable,
        details,
        reconciliationRequired: bodyRecRequired,
      } = extractErrorFromPayload(parsedObj);
      const errorCode = bodyCode ?? "SHOPIFY_USER_ERROR";
      const errorMessage = sanitizeErrorMessage(bodyMessage, "Shopify gateway operation failed");
      const reconciliationRequired =
        bodyRecRequired ??
        (errorCode === "SHOPIFY_PARTIAL_WRITE" || errorCode === "SHOPIFY_UNKNOWN_WRITE_STATE" ? true : undefined);
      throw new ShopifyApiError(errorMessage, errorCode, undefined, fields, retryable, details, reconciliationRequired);
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
      storeId:
        typeof parsedObj.storeId === "string" && parsedObj.storeId.trim() !== ""
          ? parsedObj.storeId.trim()
          : effectiveStoreId,
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
export async function runModuleApi(input: ShopifyProductsPreflightAmazonAsinsInput): Promise<ShopifyProductsPreflightAmazonAsinsResponse>;
export async function runModuleApi(input: ShopifyVariantsUpdateInput): Promise<ShopifyVariantsUpdateResponse>;
export async function runModuleApi(input: ShopifyVariantsBulkUpdateInput): Promise<ShopifyVariantsBulkUpdateResponse>;
export async function runModuleApi(input: ShopifyVariantsBulkCreateInput): Promise<ShopifyVariantsBulkCreateResponse>;
export async function runModuleApi(input: ShopifyFilesCreateInput): Promise<ShopifyFilesCreateResponse>;
export async function runModuleApi(input: ShopifyFilesBulkCreateInput): Promise<ShopifyFilesBulkCreateResponse>;
export async function runModuleApi(input: ShopifyFilesDeleteInput): Promise<ShopifyFilesDeleteResponse>;
export async function runModuleApi(input: ShopifyFilesListInput): Promise<ShopifyFilesListResponse>;
export async function runModuleApi(input: ShopifyMetafieldsSetInput): Promise<ShopifyMetafieldsSetResponse>;
export async function runModuleApi(input: ShopifyMetafieldsGetInput): Promise<ShopifyMetafieldsGetResponse>;
export async function runModuleApi(input: ShopifyMetafieldsDeleteInput): Promise<ShopifyMetafieldsDeleteResponse>;
export async function runModuleApi(input: ShopifyCollectionsListInput): Promise<ShopifyCollectionsListResponse>;
export async function runModuleApi(input: ShopifyCollectionsGetInput): Promise<ShopifyCollectionsGetResponse>;
export async function runModuleApi(input: ShopifyCollectionsCreateInput): Promise<ShopifyCollectionsCreateResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateInput): Promise<ShopifyCollectionsUpdateResponse>;
export async function runModuleApi(input: ShopifyCollectionsDeleteInput): Promise<ShopifyCollectionsDeleteResponse>;
export async function runModuleApi(input: ShopifyCollectionsUpdateMembershipInput): Promise<ShopifyCollectionsUpdateMembershipResponse>;
export async function runModuleApi(input: ShopifyStoresListInput): Promise<ShopifyStoresListResponse>;
export async function runModuleApi(input: ShopifyStoresGetInput): Promise<ShopifyStoresGetResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse>;
export async function runModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse> {
  return defaultRunner(input);
}
