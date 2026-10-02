import { AppError } from "../../shared/errors/app-error";
import { runAutoSeo } from "../auto-seo";
import type {
  AutoSeoBackupRequest,
  AutoSeoBackupResponse,
  AutoSeoClient,
  AutoSeoCollectionOption,
  AutoSeoEligibilityRequest,
  AutoSeoEligibilityResponse,
  AutoSeoOutput,
  AutoSeoSelectionInput,
  AutoSeoStoreOption,
  ShopifyProductForAutoSeoUi,
  ShopifyProductImage,
  ShopifyProductVariant,
} from "../auto-seo";
import type {
  ModuleApiRunner,
  ShopifyCollectionsListResponse,
  ShopifyProduct,
  ShopifyProductsGetInput,
  ShopifyProductsGetResponse,
  ShopifyProductsListInput,
  ShopifyProductsListResponse,
  ShopifyStoresListInput,
  ShopifyStoresListResponse,
  ShopifyStoreSummary,
} from "../module-api";

function mapShopifyProductToUi(
  product: ShopifyProduct,
  storeId?: string,
): ShopifyProductForAutoSeoUi {
  return {
    id: product.id,
    storeId: storeId ?? (product as unknown as { storeId?: string }).storeId,
    title: product.title,
    handle: product.handle,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags ? [...product.tags] : [],
    collections: product.collections
      ? product.collections.map((c) => ({
          id: c.id,
          title: c.title,
          handle: c.handle,
        }))
      : undefined,
    onlineStoreUrl: product.onlineStoreUrl,
    featuredImage: product.featuredImage
      ? {
          id: product.featuredImage.id,
          url: product.featuredImage.url,
          altText: product.featuredImage.altText,
          width: product.featuredImage.width,
          height: product.featuredImage.height,
        }
      : undefined,
    images: product.images
      ? product.images.map((img): ShopifyProductImage => ({
          id: img.id,
          url: img.url,
          altText: img.altText,
          width: img.width,
          height: img.height,
        }))
      : [],
    variants: product.variants
      ? product.variants.map((v): ShopifyProductVariant => ({
          id: v.id,
          productId: v.productId,
          title: v.title,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          sku: v.sku,
          barcode: v.barcode,
          inventoryQuantity: v.inventoryQuantity,
        }))
      : [],
    seo: product.seo
      ? {
          title: product.seo.title,
          description: product.seo.description,
        }
      : undefined,
    hasMoreVariants: product.hasMoreVariants,
    hasMoreImages: product.hasMoreImages,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrencyLimit: number,
  workerFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const safeLimit =
    Number.isFinite(concurrencyLimit) && concurrencyLimit > 0
      ? Math.max(1, Math.floor(concurrencyLimit))
      : 5;
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    async () => {
      while (nextIndex < items.length && !firstError) {
        const currentIndex = nextIndex++;
        try {
          results[currentIndex] = await workerFn(items[currentIndex]!, currentIndex);
        } catch (err) {
          if (!firstError) {
            firstError = err;
          }
          break;
        }
      }
    },
  );

  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }

  return results;
}

export class AutoSeoModuleApiClient implements AutoSeoClient {
  private readonly detailCache = new Map<string, ShopifyProductForAutoSeoUi>();
  private readonly detailVersions = new Map<string, number>();
  private readonly inFlightRequests = new Map<string, Promise<ShopifyProductForAutoSeoUi>>();
  private readonly storeSummaryCache = new Map<string, ShopifyStoreSummary>();
  private cachedStoreSummary?: ShopifyStoreSummary;
  private activeStoreId?: string;
  private versionSequence = 0;

  public constructor(private readonly moduleApiRunner: ModuleApiRunner) {}

  private getCacheKey(storeId: string, productId: string): string {
    return `${storeId.trim()}:::${productId.trim()}`;
  }

  public getCachedDetail(productId: string, storeId?: string): ShopifyProductForAutoSeoUi | undefined {
    const effectiveStoreId = storeId?.trim() || this.activeStoreId?.trim();
    if (effectiveStoreId) {
      const match = this.detailCache.get(this.getCacheKey(effectiveStoreId, productId));
      if (match) {
        return match;
      }
    }
    for (const [key, val] of this.detailCache.entries()) {
      if (key.endsWith(`:::${productId.trim()}`)) {
        return val;
      }
    }
    return undefined;
  }

  public clearDetailCache(): void {
    this.detailCache.clear();
    this.detailVersions.clear();
    this.inFlightRequests.clear();
  }

  public clearCache(): void {
    this.clearDetailCache();
    this.storeSummaryCache.clear();
    this.cachedStoreSummary = undefined;
    this.activeStoreId = undefined;
  }

  public setActiveStoreId(storeId: string): void {
    this.activeStoreId = storeId.trim();
  }

  public getActiveStoreId(): string | undefined {
    return this.activeStoreId;
  }

  public async listStores(): Promise<readonly AutoSeoStoreOption[]> {
    let response: ShopifyStoresListResponse;
    try {
      response = await this.moduleApiRunner({
        operation: "stores.list",
        payload: {},
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load Shopify stores",
        "AUTO_SEO_STORE_INFO_UNAVAILABLE",
        error,
      );
    }

    const stores = response?.data?.stores ?? [];
    const validStores: AutoSeoStoreOption[] = [];
    for (const s of stores) {
      if (
        s &&
        typeof s.storeId === "string" &&
        s.storeId.trim() !== "" &&
        typeof s.shopDomain === "string" &&
        s.shopDomain.trim() !== ""
      ) {
        const norm: ShopifyStoreSummary = {
          ...s,
          storeId: s.storeId.trim(),
          shopDomain: s.shopDomain.trim(),
        };
        this.storeSummaryCache.set(norm.storeId, norm);
        validStores.push({
          storeId: norm.storeId,
          shopDomain: norm.shopDomain,
        });
      }
    }

    return validStores;
  }

  public async listCollections(storeId?: string): Promise<readonly AutoSeoCollectionOption[]> {
    const targetStoreId = (storeId ?? this.activeStoreId)?.trim();
    if (!targetStoreId) {
      return [];
    }

    try {
      const allCollections: AutoSeoCollectionOption[] = [];
      let cursor: string | undefined = undefined;
      let hasNextPage = true;
      const seenIds = new Set<string>();

      while (hasNextPage) {
        const res: ShopifyCollectionsListResponse = await this.moduleApiRunner({
          storeId: targetStoreId,
          operation: "collections.list",
          payload: {
            limit: 250,
            ...(cursor ? { cursor } : {}),
          },
        });

        const collections = res?.data?.collections;
        if (Array.isArray(collections) && collections.length > 0) {
          for (const col of collections) {
            if (col?.id && !seenIds.has(col.id)) {
              seenIds.add(col.id);
              allCollections.push({
                id: col.id,
                title: col.title,
                handle: col.handle,
                productsCount: col.productsCount,
              });
            }
          }
        }

        const pageInfo = res?.data?.pageInfo;
        if (pageInfo?.hasNextPage && pageInfo.endCursor && !seenIds.has(pageInfo.endCursor)) {
          cursor = pageInfo.endCursor;
        } else {
          hasNextPage = false;
        }
      }

      return allCollections;
    } catch {
      return [];
    }
  }

  public async getStoreInfo(storeId?: string): Promise<{ storeId: string; shopDomain: string }> {
    const store = await this.resolveStore(storeId);
    return {
      storeId: store.storeId,
      shopDomain: store.shopDomain,
    };
  }

  private async resolveStore(targetStoreId?: string): Promise<ShopifyStoreSummary> {
    const effectiveTargetId = targetStoreId?.trim() || this.activeStoreId?.trim();

    if (effectiveTargetId && this.storeSummaryCache.has(effectiveTargetId)) {
      return this.storeSummaryCache.get(effectiveTargetId)!;
    }
    if (!effectiveTargetId && this.cachedStoreSummary) {
      return this.cachedStoreSummary;
    }

    let response: ShopifyStoresListResponse;
    try {
      response = await this.moduleApiRunner({
        operation: "stores.list",
        payload: {},
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load Shopify stores",
        "AUTO_SEO_STORE_INFO_UNAVAILABLE",
        error,
      );
    }

    const stores = response?.data?.stores ?? [];
    for (const s of stores) {
      if (
        s &&
        typeof s.storeId === "string" &&
        s.storeId.trim() !== "" &&
        typeof s.shopDomain === "string" &&
        s.shopDomain.trim() !== ""
      ) {
        const norm: ShopifyStoreSummary = {
          ...s,
          storeId: s.storeId.trim(),
          shopDomain: s.shopDomain.trim(),
        };
        this.storeSummaryCache.set(norm.storeId, norm);
      }
    }

    if (effectiveTargetId) {
      const match = this.storeSummaryCache.get(effectiveTargetId);
      if (match) {
        return match;
      }
      throw new AppError(
        `No valid Shopify store found for: ${effectiveTargetId}`,
        "AUTO_SEO_STORE_INFO_UNAVAILABLE",
      );
    }

    const store = Array.from(this.storeSummaryCache.values())[0];
    if (!store) {
      throw new AppError(
        "No valid Shopify store found",
        "AUTO_SEO_STORE_INFO_UNAVAILABLE",
      );
    }

    this.cachedStoreSummary = store;
    return store;
  }

  public async loadProducts(storeId?: string): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    try {
      const store = await this.resolveStore(storeId);
      this.activeStoreId = store.storeId;
      const products: ShopifyProductForAutoSeoUi[] = [];
      const seenProductIds = new Set<string>();
      const seenCursors = new Set<string>();
      let currentCursor: string | undefined = undefined;
      let hasNextPage = true;

      while (hasNextPage) {
        const inputPayload: ShopifyProductsListInput = {
          storeId: store.storeId,
          operation: "products.list",
          payload: {
            limit: 250,
            ...(currentCursor ? { cursor: currentCursor } : {}),
          },
        };
        const response: ShopifyProductsListResponse = await this.moduleApiRunner(inputPayload);

        const pageProducts = response?.data?.products ?? [];
        for (const product of pageProducts) {
          if (
            product &&
            typeof product.id === "string" &&
            product.id.trim() !== "" &&
            !seenProductIds.has(product.id.trim())
          ) {
            seenProductIds.add(product.id.trim());
            products.push(mapShopifyProductToUi(product, store.storeId));
          }
        }

        const pageInfo = response?.data?.pageInfo;
        if (pageInfo?.hasNextPage === true) {
          if (
            !pageInfo.endCursor ||
            typeof pageInfo.endCursor !== "string" ||
            pageInfo.endCursor.trim() === ""
          ) {
            throw new AppError(
              "Shopify pagination indicates more products but endCursor is missing",
              "AUTO_SEO_LOAD_FAILED",
            );
          }

          const trimmedCursor = pageInfo.endCursor.trim();
          if (seenCursors.has(trimmedCursor)) {
            throw new AppError(
              "Shopify pagination returned a repeated cursor: infinite loop detected",
              "AUTO_SEO_LOAD_FAILED",
            );
          }

          seenCursors.add(trimmedCursor);
          currentCursor = trimmedCursor;
        } else {
          hasNextPage = false;
        }
      }

      return products;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load products from Shopify API.",
        "AUTO_SEO_LOAD_FAILED",
        error,
      );
    }
  }

  public async loadProductDetail(productId: string): Promise<ShopifyProductForAutoSeoUi>;
  public async loadProductDetail(
    storeId: string,
    productId: string,
  ): Promise<ShopifyProductForAutoSeoUi>;
  public async loadProductDetail(
    productIdOrStoreId: string,
    maybeProductId?: string,
  ): Promise<ShopifyProductForAutoSeoUi> {
    const isStoreIdExplicit = Boolean(maybeProductId && maybeProductId.trim().length > 0);
    const rawProductId = isStoreIdExplicit ? maybeProductId! : productIdOrStoreId;

    if (!rawProductId || typeof rawProductId !== "string" || rawProductId.trim() === "") {
      throw new AppError("Product ID is required to load product detail", "AUTO_SEO_LOAD_FAILED");
    }

    const productId = rawProductId.trim();
    const store = isStoreIdExplicit
      ? await this.resolveStore(productIdOrStoreId)
      : await this.resolveStore();
    const cacheKey = this.getCacheKey(store.storeId, productId);

    const cached = this.detailCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return await inFlight;
    }

    const fetchPromise = (async (): Promise<ShopifyProductForAutoSeoUi> => {
      try {
        return await this.fetchProductDetailFresh(store.storeId, productId);
      } finally {
        this.inFlightRequests.delete(cacheKey);
      }
    })();

    this.inFlightRequests.set(cacheKey, fetchPromise);
    return await fetchPromise;
  }

  public async loadProductDetailFresh(productId: string): Promise<ShopifyProductForAutoSeoUi>;
  public async loadProductDetailFresh(
    storeId: string,
    productId: string,
  ): Promise<ShopifyProductForAutoSeoUi>;
  public async loadProductDetailFresh(
    productIdOrStoreId: string,
    maybeProductId?: string,
  ): Promise<ShopifyProductForAutoSeoUi> {
    const isStoreIdExplicit = Boolean(maybeProductId && maybeProductId.trim().length > 0);
    const rawProductId = isStoreIdExplicit ? maybeProductId! : productIdOrStoreId;

    if (!rawProductId || typeof rawProductId !== "string" || rawProductId.trim() === "") {
      throw new AppError("Product ID is required to load product detail", "AUTO_SEO_LOAD_FAILED");
    }

    const productId = rawProductId.trim();
    const store = isStoreIdExplicit
      ? await this.resolveStore(productIdOrStoreId)
      : await this.resolveStore();

    return this.fetchProductDetailFresh(store.storeId, productId);
  }

  private async fetchProductDetailFresh(
    storeId: string,
    productId: string,
  ): Promise<ShopifyProductForAutoSeoUi> {
    const cacheKey = this.getCacheKey(storeId, productId);
    const requestVersion = ++this.versionSequence;
    try {
      const getInput: ShopifyProductsGetInput = {
        storeId,
        operation: "products.get",
        payload: {
          id: productId,
        },
      };
      const response: ShopifyProductsGetResponse = await this.moduleApiRunner(getInput);

      const product = response?.data?.product;
      if (!product) {
        throw new AppError(
          `Product not found: ${productId}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      const uiProduct = mapShopifyProductToUi(product, storeId);
      const currentVersion = this.detailVersions.get(cacheKey) ?? 0;
      if (requestVersion >= currentVersion) {
        this.detailVersions.set(cacheKey, requestVersion);
        this.detailCache.set(cacheKey, uiProduct);
      }
      return uiProduct;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load product detail from Shopify API.",
        "AUTO_SEO_LOAD_FAILED",
        error,
      );
    }
  }

  public async hydrateSelectedProductsFresh(
    productIds: readonly string[],
    concurrency = 5,
    storeId?: string,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim())));
    const store = await this.resolveStore(storeId);
    const productMap = new Map<string, ShopifyProductForAutoSeoUi>();

    await runWithConcurrency(uniqueIds, concurrency, async (id) => {
      const product = await this.fetchProductDetailFresh(store.storeId, id);
      productMap.set(id, product);
    });

    return productIds.map((rawId) => {
      const id = rawId.trim();
      const product = productMap.get(id);
      if (!product) {
        throw new AppError(
          `Failed to hydrate product detail for product ${rawId}: product detail not found`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }
      return product;
    });
  }

  public async hydrateSelectedProducts(
    productIds: readonly string[],
    concurrency = 5,
    storeId?: string,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim())));
    const productMap = new Map<string, ShopifyProductForAutoSeoUi>();
    const idsToFetch: string[] = [];
    const store = await this.resolveStore(storeId);

    for (const id of uniqueIds) {
      const cacheKey = this.getCacheKey(store.storeId, id);
      const cached = this.detailCache.get(cacheKey);
      if (cached) {
        productMap.set(id, cached);
      } else {
        idsToFetch.push(id);
      }
    }

    if (idsToFetch.length > 0) {
      await runWithConcurrency(idsToFetch, concurrency, async (id) => {
        const detail = await this.loadProductDetail(store.storeId, id);
        productMap.set(id, detail);
      });
    }

    return productIds.map((rawId) => {
      const id = rawId.trim();
      const product = productMap.get(id);
      if (!product) {
        throw new AppError(
          `Failed to hydrate product detail for product ${rawId}: product detail not found`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }
      return product;
    });
  }

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    return runAutoSeo(input);
  }

  public async getProductEligibility(
    request: AutoSeoEligibilityRequest,
  ): Promise<AutoSeoEligibilityResponse> {
    try {
      const response = await fetch("/api/auto-seo/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object") {
        throw new AppError("Failed to load Auto SEO eligibility", "AUTO_SEO_LOAD_FAILED");
      }
      const envelope = payload as {
        readonly success?: unknown;
        readonly data?: unknown;
        readonly error?: { readonly code?: unknown; readonly message?: unknown };
      };
      if (envelope.success !== true) {
        throw new AppError(
          typeof envelope.error?.message === "string"
            ? envelope.error.message
            : "Failed to load Auto SEO eligibility",
          typeof envelope.error?.code === "string" ? envelope.error.code : "AUTO_SEO_LOAD_FAILED",
        );
      }
      if (!isAutoSeoEligibilityResponse(envelope.data)) {
        throw new AppError("Invalid Auto SEO eligibility response", "AUTO_SEO_LOAD_FAILED");
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load Auto SEO eligibility",
        "AUTO_SEO_LOAD_FAILED",
        error,
      );
    }
  }

  public async runAutoSeoBackup(
    request: AutoSeoBackupRequest,
  ): Promise<AutoSeoBackupResponse> {
    try {
      const response = await fetch("/api/auto-seo/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      const payload: unknown = await response.json().catch(() => null);
      const envelope = payload && typeof payload === "object"
        ? payload as {
            readonly success?: unknown;
            readonly data?: unknown;
            readonly error?: { readonly code?: unknown; readonly message?: unknown };
          }
        : undefined;
      if (!response.ok || envelope?.success !== true) {
        const errorCode = typeof envelope?.error?.code === "string"
          ? envelope.error.code
          : "AUTO_SEO_BACKUP_FAILED";
        const message = typeof envelope?.error?.message === "string"
          ? envelope.error.message
          : "Failed to execute Auto SEO backup";
        throw new AppError(message, errorCode);
      }
      if (!isAutoSeoBackupResponse(envelope.data)) {
        throw new AppError("Invalid Auto SEO backup response", "AUTO_SEO_BACKUP_FAILED");
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to execute Auto SEO backup",
        "AUTO_SEO_BACKUP_FAILED",
        error,
      );
    }
  }
}

function isAutoSeoBackupResponse(value: unknown): value is AutoSeoBackupResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Readonly<Record<string, unknown>>;
  if (
    typeof response.workflowId !== "string" ||
    typeof response.backedUpCount !== "number" ||
    !Array.isArray(response.backupIds) ||
    !response.backupIds.every(id => typeof id === "string") ||
    (response.downstreamStatus !== "SENT" && response.downstreamStatus !== "FAILED")
  ) {
    return false;
  }
  if (response.acceptedCount !== undefined && typeof response.acceptedCount !== "number") {
    return false;
  }
  if (
    response.acceptedProductIds !== undefined &&
    (!Array.isArray(response.acceptedProductIds) ||
      !response.acceptedProductIds.every(id => typeof id === "string"))
  ) {
    return false;
  }
  if (response.skippedCount !== undefined && typeof response.skippedCount !== "number") {
    return false;
  }
  if (response.skippedProducts !== undefined) {
    if (!Array.isArray(response.skippedProducts)) return false;
    for (const skippedProduct of response.skippedProducts) {
      if (!skippedProduct || typeof skippedProduct !== "object") return false;
      const skipped = skippedProduct as Readonly<Record<string, unknown>>;
      if (
        typeof skipped.productId !== "string" ||
        (skipped.reason !== "UNCHANGED" && skipped.reason !== "ACTIVE_DUPLICATE")
      ) {
        return false;
      }
    }
  }
  return true;
}

function isAutoSeoEligibilityResponse(value: unknown): value is AutoSeoEligibilityResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as { readonly items?: unknown; readonly counts?: unknown };
  if (!Array.isArray(response.items) || !response.counts || typeof response.counts !== "object") {
    return false;
  }
  const validStates = new Set(["never_processed", "changed", "current", "active", "retry"]);
  if (!response.items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const entry = item as { readonly productId?: unknown; readonly state?: unknown; readonly reason?: unknown };
    return typeof entry.productId === "string" &&
      typeof entry.state === "string" && validStates.has(entry.state) &&
      typeof entry.reason === "string";
  })) return false;
  const counts = response.counts as Readonly<Record<string, unknown>>;
  return [...validStates].every((state) => typeof counts[state] === "number");
}

export function createAutoSeoModuleApiClient(
  moduleApiRunner: ModuleApiRunner,
): AutoSeoClient {
  return new AutoSeoModuleApiClient(moduleApiRunner);
}
