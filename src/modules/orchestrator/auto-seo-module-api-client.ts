import { AppError } from "../../shared/errors/app-error";
import { runAutoSeo } from "../auto-seo";
import type {
  AutoSeoBackupRequest,
  AutoSeoBackupResponse,
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoSelectionInput,
  ShopifyProductForAutoSeoUi,
  ShopifyProductImage,
  ShopifyProductVariant,
} from "../auto-seo";
import type {
  ModuleApiRunner,
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
): ShopifyProductForAutoSeoUi {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags ? [...product.tags] : [],
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
  private cachedStoreSummary?: ShopifyStoreSummary;
  private versionSequence = 0;

  public constructor(private readonly moduleApiRunner: ModuleApiRunner) {}

  public getCachedDetail(productId: string): ShopifyProductForAutoSeoUi | undefined {
    return this.detailCache.get(productId.trim());
  }

  public clearDetailCache(): void {
    this.detailCache.clear();
    this.detailVersions.clear();
    this.inFlightRequests.clear();
  }

  public clearCache(): void {
    this.clearDetailCache();
    this.cachedStoreSummary = undefined;
  }

  public async getStoreInfo(): Promise<{ storeId: string; shopDomain: string }> {
    const store = await this.resolveStore();
    return {
      storeId: store.storeId,
      shopDomain: store.shopDomain,
    };
  }

  private async resolveStore(): Promise<ShopifyStoreSummary> {
    if (this.cachedStoreSummary) {
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

    const stores = response?.data?.stores;
    // For the current single-store flow: use the first available store.
    // TODO: Multi-store selection must be explicit in a future phase.
    const store = stores?.find(
      (s) =>
        s &&
        typeof s.storeId === "string" &&
        s.storeId.trim() !== "" &&
        typeof s.shopDomain === "string" &&
        s.shopDomain.trim() !== "",
    );

    if (!store) {
      throw new AppError(
        "No valid Shopify store found",
        "AUTO_SEO_STORE_INFO_UNAVAILABLE",
      );
    }

    const normalizedStore: ShopifyStoreSummary = {
      ...store,
      storeId: store.storeId.trim(),
      shopDomain: store.shopDomain.trim(),
    };

    this.cachedStoreSummary = normalizedStore;
    return normalizedStore;
  }

  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    try {
      const store = await this.resolveStore();
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
            products.push(mapShopifyProductToUi(product));
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
    const cached = this.detailCache.get(productId);
    if (cached) {
      return cached;
    }

    const inFlight = this.inFlightRequests.get(productId);
    if (inFlight) {
      return await inFlight;
    }

    const fetchPromise = (async (): Promise<ShopifyProductForAutoSeoUi> => {
      try {
        const storeId = isStoreIdExplicit
          ? productIdOrStoreId.trim()
          : (await this.resolveStore()).storeId;
        return await this.fetchProductDetailFresh(storeId, productId);
      } finally {
        this.inFlightRequests.delete(productId);
      }
    })();

    this.inFlightRequests.set(productId, fetchPromise);
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
    const storeId = isStoreIdExplicit
      ? productIdOrStoreId.trim()
      : (await this.resolveStore()).storeId;

    return this.fetchProductDetailFresh(storeId, productId);
  }

  private async fetchProductDetailFresh(
    storeId: string,
    productId: string,
  ): Promise<ShopifyProductForAutoSeoUi> {
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

      const uiProduct = mapShopifyProductToUi(product);
      const currentVersion = this.detailVersions.get(productId) ?? 0;
      if (requestVersion >= currentVersion) {
        this.detailVersions.set(productId, requestVersion);
        this.detailCache.set(productId, uiProduct);
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
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim())));
    const store = await this.resolveStore();
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
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim())));
    const productMap = new Map<string, ShopifyProductForAutoSeoUi>();
    const idsToFetch: string[] = [];

    for (const id of uniqueIds) {
      const cached = this.detailCache.get(id);
      if (cached) {
        productMap.set(id, cached);
      } else {
        idsToFetch.push(id);
      }
    }

    if (idsToFetch.length > 0) {
      const store = await this.resolveStore();
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

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const errorCode = data?.error?.code || "AUTO_SEO_BACKUP_FAILED";
        const message = data?.error?.message || "Failed to execute Auto SEO backup";
        throw new AppError(message, errorCode);
      }

      return data.data as AutoSeoBackupResponse;
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

export function createAutoSeoModuleApiClient(
  moduleApiRunner: ModuleApiRunner,
): AutoSeoClient {
  return new AutoSeoModuleApiClient(moduleApiRunner);
}
