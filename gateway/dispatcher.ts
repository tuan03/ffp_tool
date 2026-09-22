import { GatewayError } from "./errors";
import {
  calculateCanonicalHash,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
} from "./idempotency";
import { executeCollectionsGet, executeCollectionsList } from "./operations/collections";
import {
  executeCollectionsCreate,
  executeCollectionsDelete,
  executeCollectionsUpdate,
  executeCollectionsUpdateMembership,
} from "./operations/collections-write";
import { executeConnectionTest } from "./operations/connection-test";
import { executeProductsGet, executeProductsList } from "./operations/products";
import {
  executeProductsBulkUpdate,
  executeProductsCreate,
  executeProductsDelete,
  executeProductsUpdate,
} from "./operations/products-write";
import {
  executeVariantsBulkUpdate,
  executeVariantsUpdate,
} from "./operations/variants-write";
import {
  executeStoresGet,
  executeStoresList,
} from "./operations/store-management";
import type { ShopifyGraphqlClient } from "./shopify-graphql-client";
import type { StoreRegistry } from "./store-registry";
import type { GatewayRequest, GatewayResponse, StoreConfig } from "./types";

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "products.create",
  "products.update",
  "products.bulkUpdate",
  "products.delete",
  "variants.update",
  "variants.bulkUpdate",
  "collections.create",
  "collections.update",
  "collections.delete",
  "collections.updateMembership",
]);

const STORE_OPERATIONS: ReadonlySet<string> = new Set([
  "stores.list",
  "stores.get",
]);

export interface GatewayDispatcherOptions {
  readonly storeRegistry: StoreRegistry;
  readonly graphqlClient: ShopifyGraphqlClient;
  readonly idempotencyStore?: IdempotencyStore;
}

interface InFlightRecord {
  readonly promise: Promise<unknown>;
  readonly operation: string;
  readonly canonicalHash: string;
}

export class GatewayDispatcher {
  private readonly storeRegistry: StoreRegistry;
  private readonly graphqlClient: ShopifyGraphqlClient;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly inFlightWrites = new Map<string, InFlightRecord>();

  public constructor(options: GatewayDispatcherOptions) {
    this.storeRegistry = options.storeRegistry;
    this.graphqlClient = options.graphqlClient;
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  public async dispatch(request: GatewayRequest): Promise<GatewayResponse> {
    if (!request || typeof request !== "object") {
      throw new GatewayError("Invalid gateway request payload", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (!request.operation || request.operation.trim() === "") {
      throw new GatewayError("operation is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    if (request.operation === "stores.register" || request.operation === "stores.disconnect") {
      throw new GatewayError(
        "Store registration and disconnection must be executed via the Store Control Plane",
        "SHOPIFY_PERMISSION_DENIED",
        403,
      );
    }

    const payloadTargetId =
      request.payload && typeof request.payload === "object"
        ? (request.payload as Record<string, unknown>).targetStoreId ||
          (request.payload as Record<string, unknown>).storeId
        : undefined;

    if (request.operation === "stores.get") {
      const targetId =
        typeof payloadTargetId === "string" && (payloadTargetId as string).trim() !== ""
          ? (payloadTargetId as string).trim()
          : typeof request.storeId === "string" && request.storeId.trim() !== ""
          ? request.storeId.trim()
          : "";
      if (!targetId) {
        throw new GatewayError("targetStoreId is required", "SHOPIFY_INVALID_INPUT", 400);
      }
    }

    const effectiveStoreId =
      typeof request.storeId === "string" && request.storeId.trim() !== ""
        ? request.storeId.trim()
        : typeof payloadTargetId === "string" && (payloadTargetId as string).trim() !== ""
        ? (payloadTargetId as string).trim()
        : request.operation === "stores.list"
        ? "system"
        : "";

    if (!effectiveStoreId) {
      throw new GatewayError("storeId is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    // 0. Store Management Operations (read-only safe summaries)
    if (STORE_OPERATIONS.has(request.operation)) {
      const data = await this.executeStoreOperation(request.operation, request.payload, effectiveStoreId);
      return {
        storeId: effectiveStoreId,
        operation: request.operation,
        success: true,
        data,
      };
    }

    const store = await this.storeRegistry.getStore(effectiveStoreId);
    if (!store) {
      throw new GatewayError(`Store not found: ${effectiveStoreId}`, "SHOPIFY_NOT_FOUND", 404);
    }

    const isWrite = WRITE_OPERATIONS.has(request.operation);
    if (isWrite) {
      if (request.mode !== "preview" && request.mode !== "apply") {
        throw new GatewayError(
          "Write operations require an explicit mode: 'preview' or 'apply'",
          "SHOPIFY_INVALID_INPUT",
          400,
        );
      }
    }
    const mode: "preview" | "apply" = request.mode === "preview" ? "preview" : "apply";
    const requestId =
      typeof request.requestId === "string" && request.requestId.trim() !== ""
        ? request.requestId.trim()
        : undefined;

    // 1. Preview Mode: MUST NEVER write to IdempotencyStore or execute real mutation
    if (isWrite && mode === "preview") {
      const data = await this.executeWrite(store, request.operation, request.payload, "preview", requestId);
      return {
        storeId: effectiveStoreId,
        operation: request.operation,
        success: true,
        data,
      };
    }

    // 2. Apply Mode for Writes: MUST enforce requestId and check Idempotency
    if (isWrite) {
      if (!requestId) {
        throw new GatewayError(
          "requestId is required for write operations in apply mode",
          "SHOPIFY_USER_ERROR",
          400,
        );
      }

      // Identity: storeId + requestId (operation stored separately in entry)
      const idempotencyKey = `${store.storeId}:${requestId}`;
      const canonicalHash = calculateCanonicalHash(request.operation, request.payload);

      // Check in-flight concurrent requests first (synchronous check)
      const inFlight = this.inFlightWrites.get(idempotencyKey);
      if (inFlight) {
        if (inFlight.operation !== request.operation) {
          throw new GatewayError(
            `RequestId '${requestId}' is currently in-flight for operation '${inFlight.operation}'`,
            "SHOPIFY_USER_ERROR",
            409,
          );
        }
        if (inFlight.canonicalHash !== canonicalHash) {
          throw new GatewayError(
            `RequestId '${requestId}' is currently in-flight with a different payload`,
            "SHOPIFY_USER_ERROR",
            409,
          );
        }
        const data = await inFlight.promise;
        return {
          storeId: effectiveStoreId,
          operation: request.operation,
          success: true,
          data,
        };
      }

      let resolveInFlight!: (val: unknown) => void;
      let rejectInFlight!: (err: unknown) => void;
      const inFlightPromise = new Promise<unknown>((resolve, reject) => {
        resolveInFlight = resolve;
        rejectInFlight = reject;
      });
      inFlightPromise.catch(() => {});

      this.inFlightWrites.set(idempotencyKey, {
        operation: request.operation,
        canonicalHash,
        promise: inFlightPromise,
      });

      let hasSetPending = false;
      try {
        // Check cached entry
        const cached = await this.idempotencyStore.get(idempotencyKey);
        if (cached) {
          if (cached.operation !== request.operation) {
            throw new GatewayError(
              `RequestId '${requestId}' was previously used for operation '${cached.operation}'`,
              "SHOPIFY_USER_ERROR",
              409,
            );
          }
          if (cached.payloadHash !== canonicalHash) {
            throw new GatewayError(
              `RequestId '${requestId}' has already been used with a different payload`,
              "SHOPIFY_USER_ERROR",
              409,
            );
          }
          if (cached.state === "COMPLETED") {
            resolveInFlight(cached.responseData);
            return {
              storeId: effectiveStoreId,
              operation: request.operation,
              success: true,
              data: cached.responseData,
            };
          }
          if (cached.state === "RECONCILIATION_REQUIRED") {
            const createdProductId =
              cached.responseData &&
              typeof cached.responseData === "object" &&
              "createdProductId" in (cached.responseData as Record<string, unknown>)
                ? String((cached.responseData as Record<string, unknown>).createdProductId)
                : cached.details && "createdProductId" in cached.details
                ? String(cached.details.createdProductId)
                : undefined;
            const updatedProductId =
              cached.responseData &&
              typeof cached.responseData === "object" &&
              "updatedProductId" in (cached.responseData as Record<string, unknown>)
                ? String((cached.responseData as Record<string, unknown>).updatedProductId)
                : cached.details && "updatedProductId" in cached.details
                ? String(cached.details.updatedProductId)
                : undefined;
            const updatedProductIds =
              cached.responseData &&
              typeof cached.responseData === "object" &&
              Array.isArray((cached.responseData as Record<string, unknown>).updatedProductIds)
                ? ((cached.responseData as Record<string, unknown>).updatedProductIds as readonly string[])
                : cached.details && Array.isArray(cached.details.updatedProductIds)
                ? (cached.details.updatedProductIds as readonly string[])
                : undefined;
            const affectedProductId = createdProductId ?? updatedProductId;
            const isPartial = Boolean(affectedProductId || (updatedProductIds && updatedProductIds.length > 0));

            throw new GatewayError(
              `RequestId '${requestId}' is in a reconciliation-required write state on Shopify and requires manual reconciliation before retrying`,
              isPartial ? "SHOPIFY_PARTIAL_WRITE" : "SHOPIFY_UNKNOWN_WRITE_STATE",
              409,
              undefined,
              undefined,
              undefined,
              false,
              {
                ...(createdProductId ? { createdProductId } : {}),
                ...(updatedProductId ? { updatedProductId } : {}),
                ...(updatedProductIds ? { updatedProductIds } : {}),
                reconciliationRequired: true,
              },
              true,
            );
          }
        }

        // Record PENDING state in IdempotencyStore
        await this.idempotencyStore.set(idempotencyKey, {
          state: "PENDING",
          operation: request.operation,
          payloadHash: canonicalHash,
          createdAtMs: Date.now(),
        });
        hasSetPending = true;

        const data = await this.executeWrite(store, request.operation, request.payload, "apply", requestId);

        const hasReconciliation =
          data &&
          typeof data === "object" &&
          "reconciliationRequired" in (data as Record<string, unknown>) &&
          (data as Record<string, unknown>).reconciliationRequired === true;

        if (hasReconciliation) {
          await this.idempotencyStore.set(idempotencyKey, {
            state: "RECONCILIATION_REQUIRED",
            operation: request.operation,
            payloadHash: canonicalHash,
            responseData: data,
            details: { reconciliationRequired: true },
            createdAtMs: Date.now(),
          });
        } else {
          await this.idempotencyStore.set(idempotencyKey, {
            state: "COMPLETED",
            operation: request.operation,
            payloadHash: canonicalHash,
            responseData: data,
            createdAtMs: Date.now(),
          });
        }

        resolveInFlight(data);
        return {
          storeId: effectiveStoreId,
          operation: request.operation,
          success: true,
          data,
        };
      } catch (err: unknown) {
        const isUnknownWriteState =
          err instanceof GatewayError && err.code === "SHOPIFY_UNKNOWN_WRITE_STATE";
        const isPartialWrite =
          err instanceof GatewayError &&
          (err.code === "SHOPIFY_PARTIAL_WRITE" ||
            err.reconciliationRequired === true ||
            Boolean(err.details?.reconciliationRequired));

        if (isUnknownWriteState || isPartialWrite) {
          const createdProductId =
            err instanceof GatewayError && err.details?.createdProductId
              ? String(err.details.createdProductId)
              : undefined;
          const updatedProductId =
            err instanceof GatewayError && err.details?.updatedProductId
              ? String(err.details.updatedProductId)
              : undefined;
          const updatedProductIds =
            err instanceof GatewayError && Array.isArray(err.details?.updatedProductIds)
              ? (err.details.updatedProductIds as readonly string[])
              : undefined;

          await this.idempotencyStore.set(idempotencyKey, {
            state: "RECONCILIATION_REQUIRED",
            operation: request.operation,
            payloadHash: canonicalHash,
            responseData: {
              ...(createdProductId ? { createdProductId } : {}),
              ...(updatedProductId ? { updatedProductId } : {}),
              ...(updatedProductIds ? { updatedProductIds } : {}),
            },
            details: {
              ...(createdProductId ? { createdProductId } : {}),
              ...(updatedProductId ? { updatedProductId } : {}),
              ...(updatedProductIds ? { updatedProductIds } : {}),
              reconciliationRequired: true,
            },
            createdAtMs: Date.now(),
          });
        } else if (hasSetPending) {
          await this.idempotencyStore.delete(idempotencyKey);
        }
        rejectInFlight(err);
        throw err;
      } finally {
        this.inFlightWrites.delete(idempotencyKey);
      }
    }

    // 3. Read Operations
    const data = await this.executeRead(store, request.operation, request.payload, requestId);
    return {
      storeId: effectiveStoreId,
      operation: request.operation,
      success: true,
      data,
    };
  }

  private async executeRead(
    store: StoreConfig,
    operation: string,
    payload: unknown,
    requestId?: string,
  ): Promise<unknown> {
    switch (operation) {
      case "connection.test":
        return executeConnectionTest(store, this.graphqlClient, payload);
      case "products.list":
        return executeProductsList(store, this.graphqlClient, payload);
      case "products.get":
        return executeProductsGet(store, this.graphqlClient, payload);
      case "collections.list":
        return executeCollectionsList(store, this.graphqlClient, payload);
      case "collections.get":
        return executeCollectionsGet(store, this.graphqlClient, payload);
      default:
        throw new GatewayError(`Unsupported operation: ${operation}`, "NOT_IMPLEMENTED", 501);
    }
  }

  private async executeWrite(
    store: StoreConfig,
    operation: string,
    payload: unknown,
    mode: "preview" | "apply",
    requestId?: string,
  ): Promise<unknown> {
    switch (operation) {
      case "products.create":
        return executeProductsCreate(store, this.graphqlClient, payload, mode, requestId);
      case "products.update":
        return executeProductsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "products.bulkUpdate":
        return executeProductsBulkUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "products.delete":
        return executeProductsDelete(store, this.graphqlClient, payload, mode, requestId);
      case "variants.update":
        return executeVariantsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "variants.bulkUpdate":
        return executeVariantsBulkUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.create":
        return executeCollectionsCreate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.update":
        return executeCollectionsUpdate(store, this.graphqlClient, payload, mode, requestId);
      case "collections.delete":
        return executeCollectionsDelete(store, this.graphqlClient, payload, mode, requestId);
      case "collections.updateMembership":
        return executeCollectionsUpdateMembership(store, this.graphqlClient, payload, mode, requestId);
      default:
        throw new GatewayError(`Unsupported write operation: ${operation}`, "NOT_IMPLEMENTED", 501);
    }
  }

  private async executeStoreOperation(
    operation: string,
    payload: unknown,
    defaultStoreId: string,
  ): Promise<unknown> {
    switch (operation) {
      case "stores.list":
        return executeStoresList(this.storeRegistry, payload);
      case "stores.get":
        return executeStoresGet(this.storeRegistry, payload, defaultStoreId);
      default:
        throw new GatewayError(`Unsupported store operation: ${operation}`, "NOT_IMPLEMENTED", 501);
    }
  }
}
