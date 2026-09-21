import { AppError } from "../../shared/errors/app-error";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  SeoContentInputPayload,
  ShopifyProductForAutoSeoUi,
} from "./types";

export async function runAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const warnings: string[] = [];

  if (input.products.length === 0) {
    warnings.push("Product list is empty.");
  }

  const hasSelectedIds =
    Array.isArray(input.selectedProductIds) && input.selectedProductIds.length > 0;
  const hasSelectedHandles =
    Array.isArray(input.selectedHandles) && input.selectedHandles.length > 0;

  const selectedIdSet = new Set(input.selectedProductIds ?? []);
  const selectedHandleSet = new Set(input.selectedHandles ?? []);

  if (hasSelectedIds) {
    for (const id of selectedIdSet) {
      const exists = input.products.some((product) => product.productId === id);
      if (!exists) {
        warnings.push(`Selected product ID not found: ${id}`);
      }
    }
  }

  if (hasSelectedHandles) {
    for (const handle of selectedHandleSet) {
      const exists = input.products.some((product) => product.handle === handle);
      if (!exists) {
        warnings.push(`Selected product handle not found: ${handle}`);
      }
    }
  }

  const isSelectAll = !hasSelectedIds && !hasSelectedHandles;
  const selectedProducts: AutoSeoProductCandidate[] = [];
  const seenProductIds = new Set<string>();

  for (const product of input.products) {
    const isMatched =
      isSelectAll ||
      selectedIdSet.has(product.productId) ||
      selectedHandleSet.has(product.handle);

    if (isMatched && !seenProductIds.has(product.productId)) {
      seenProductIds.add(product.productId);
      selectedProducts.push(product);
    }
  }

  const seoContentInputs: SeoContentInputPayload[] = selectedProducts.map(
    (product) => {
      validateProduct(product, warnings);

      return {
        productId: product.productId,
        handle: product.handle.trim(),
        sourceTitle: product.title.trim(),
        sourceDescriptionHtml: product.descriptionHtml,
        sourceSeoTitle: product.seoTitle ?? null,
        sourceSeoDescription: product.seoDescription ?? null,
        images: product.images,
      };
    },
  );

  return {
    workflowId: input.workflowId,
    selectedCount: seoContentInputs.length,
    seoContentInputs,
    warnings,
  };
}

function validateProduct(
  product: AutoSeoProductCandidate,
  warnings: string[],
): void {
  if (product.productId.trim().length === 0) {
    warnings.push("Selected product has empty productId.");
  }
  if (product.handle.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty handle.`);
  }
  if (product.title.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty title.`);
  }
  if (product.descriptionHtml.trim().length === 0) {
    warnings.push(
      `Selected product ${product.productId} has empty descriptionHtml.`,
    );
  }
  if (product.images.length === 0) {
    warnings.push(`Selected product ${product.productId} has no images.`);
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const safeLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (nextIndex < items.length && !firstError) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
      } catch (err) {
        if (!firstError) {
          firstError = err;
        }
        break;
      }
    }
  });

  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }

  return results;
}

export async function hydrateSelectedProducts(
  client: AutoSeoClient,
  productIds: readonly string[],
  concurrency = 5,
): Promise<readonly ShopifyProductForAutoSeoUi[]> {
  if (typeof client.hydrateSelectedProducts === "function") {
    return client.hydrateSelectedProducts(productIds, concurrency);
  }

  if (productIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(productIds));
  const productMap = new Map<string, ShopifyProductForAutoSeoUi>();

  const idsToFetch: string[] = [];
  for (const id of uniqueIds) {
    const cached = client.getCachedDetail?.(id);
    if (cached) {
      productMap.set(id, cached);
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length > 0) {
    await mapWithConcurrency(idsToFetch, concurrency, async (id) => {
      try {
        const detail = await client.loadProductDetail(id);
        productMap.set(id, detail);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new AppError(
          `Failed to hydrate product detail for product ${id}: ${message}`,
          "AUTO_SEO_LOAD_FAILED",
          err,
        );
      }
    });
  }

  return productIds.map((id) => {
    const product = productMap.get(id);
    if (!product) {
      throw new AppError(
        `Failed to hydrate product detail for product ${id}: product detail not found`,
        "AUTO_SEO_LOAD_FAILED",
      );
    }
    return product;
  });
}

export class RealAutoSeoClient implements AutoSeoClient {
  private readonly detailCache = new Map<string, ShopifyProductForAutoSeoUi>();
  private readonly inFlightRequests = new Map<string, Promise<ShopifyProductForAutoSeoUi>>();
  private cachedStoreId?: string;

  public constructor(
    private readonly baseUrl = "",
    private readonly customFetch?: typeof fetch,
  ) {}

  public getCachedDetail(productId: string): ShopifyProductForAutoSeoUi | undefined {
    return this.detailCache.get(productId);
  }

  public clearDetailCache(): void {
    this.detailCache.clear();
    this.inFlightRequests.clear();
  }

  public clearCache(): void {
    this.clearDetailCache();
    this.cachedStoreId = undefined;
  }

  public async getStoreId(): Promise<string> {
    if (this.cachedStoreId && this.cachedStoreId.trim() !== "") {
      return this.cachedStoreId;
    }

    const fetchFn = this.customFetch ?? fetch;

    const storesResponse = await fetchFn(`${this.baseUrl}/api/shopify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "stores.list",
        payload: {},
      }),
    });

    if (!storesResponse.ok) {
      throw new AppError(
        `Failed to load Shopify stores: HTTP ${storesResponse.status}`,
        "AUTO_SEO_LOAD_FAILED",
      );
    }

    const storesPayload = (await storesResponse.json()) as {
      readonly success?: boolean;
      readonly error?: { readonly message?: string };
      readonly data?: {
        readonly stores?: readonly { readonly storeId?: string }[];
      };
      readonly stores?: readonly { readonly storeId?: string }[];
    };

    if (storesPayload && typeof storesPayload === "object" && storesPayload.success === false) {
      throw new AppError(
        storesPayload.error?.message ?? "Failed to load Shopify stores",
        "AUTO_SEO_LOAD_FAILED",
      );
    }

    // TODO: Multi-store selection must be explicit in a future phase.
    const storeId =
      storesPayload?.data?.stores?.[0]?.storeId ??
      storesPayload?.stores?.[0]?.storeId;

    if (!storeId || typeof storeId !== "string" || storeId.trim() === "") {
      throw new AppError("No available Shopify store found", "AUTO_SEO_LOAD_FAILED");
    }

    this.cachedStoreId = storeId;
    return storeId;
  }

  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    const fetchFn = this.customFetch ?? fetch;

    try {
      const storeId = await this.getStoreId();

      const products: ShopifyProductForAutoSeoUi[] = [];
      const seenProductIds = new Set<string>();
      const seenCursors = new Set<string>();
      let currentCursor: string | undefined = undefined;
      let hasNextPage = true;

      while (hasNextPage) {
        const productsResponse = await fetchFn(`${this.baseUrl}/api/shopify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            storeId,
            operation: "products.list",
            payload: {
              limit: 250,
              ...(currentCursor ? { cursor: currentCursor } : {}),
            },
          }),
        });

        if (!productsResponse.ok) {
          throw new AppError(
            `Failed to load Shopify products: HTTP ${productsResponse.status}`,
            "AUTO_SEO_LOAD_FAILED",
          );
        }

        const productsPayload = (await productsResponse.json()) as {
          readonly success?: boolean;
          readonly error?: { readonly message?: string };
          readonly data?: {
            readonly products?: readonly ShopifyProductForAutoSeoUi[];
            readonly pageInfo?: {
              readonly hasNextPage?: boolean;
              readonly endCursor?: string | null;
            };
          };
          readonly products?: readonly ShopifyProductForAutoSeoUi[];
          readonly pageInfo?: {
            readonly hasNextPage?: boolean;
            readonly endCursor?: string | null;
          };
        };

        if (productsPayload && typeof productsPayload === "object" && productsPayload.success === false) {
          throw new AppError(
            productsPayload.error?.message ?? "Failed to load Shopify products",
            "AUTO_SEO_LOAD_FAILED",
          );
        }

        let pageProducts: readonly ShopifyProductForAutoSeoUi[] = [];
        if (Array.isArray(productsPayload?.data?.products)) {
          pageProducts = productsPayload.data.products;
        } else if (Array.isArray(productsPayload?.products)) {
          pageProducts = productsPayload.products;
        } else if (Array.isArray(productsPayload)) {
          pageProducts = productsPayload as unknown as readonly ShopifyProductForAutoSeoUi[];
        }

        for (const product of pageProducts) {
          if (
            product &&
            typeof product.id === "string" &&
            product.id.trim() !== "" &&
            !seenProductIds.has(product.id)
          ) {
            seenProductIds.add(product.id);
            products.push(product);
          }
        }

        const pageInfo =
          productsPayload?.data?.pageInfo ?? productsPayload?.pageInfo;

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
    const productId = isStoreIdExplicit ? maybeProductId! : productIdOrStoreId;

    if (!productId || typeof productId !== "string" || productId.trim() === "") {
      throw new AppError("Product ID is required to load product detail", "AUTO_SEO_LOAD_FAILED");
    }

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
        const storeId = isStoreIdExplicit ? productIdOrStoreId : await this.getStoreId();
        const product = await this.fetchProductDetailFromApi(storeId, productId);
        this.detailCache.set(productId, product);
        return product;
      } finally {
        this.inFlightRequests.delete(productId);
      }
    })();

    this.inFlightRequests.set(productId, fetchPromise);
    return await fetchPromise;
  }

  private async fetchProductDetailFromApi(
    storeId: string,
    productId: string,
  ): Promise<ShopifyProductForAutoSeoUi> {
    const fetchFn = this.customFetch ?? fetch;

    try {
      const response = await fetchFn(`${this.baseUrl}/api/shopify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId,
          operation: "products.get",
          payload: {
            id: productId,
          },
        }),
      });

      if (!response.ok) {
        throw new AppError(
          `Failed to load Shopify product detail: HTTP ${response.status}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      const payload = (await response.json()) as {
        readonly success?: boolean;
        readonly error?: { readonly message?: string; readonly code?: string };
        readonly data?: {
          readonly product?: ShopifyProductForAutoSeoUi | null;
        };
        readonly product?: ShopifyProductForAutoSeoUi | null;
      };

      if (payload && typeof payload === "object" && payload.success === false) {
        throw new AppError(
          payload.error?.message ?? `Failed to load Shopify product detail for ${productId}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      const product = payload?.data?.product ?? payload?.product;

      if (!product || typeof product !== "object") {
        throw new AppError(
          `Product not found: ${productId}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      return product;
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

  public async hydrateSelectedProducts(
    productIds: readonly string[],
    concurrency = 5,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds));
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
      await mapWithConcurrency(idsToFetch, concurrency, async (id) => {
        try {
          const detail = await this.loadProductDetail(id);
          productMap.set(id, detail);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new AppError(
            `Failed to hydrate product detail for product ${id}: ${message}`,
            "AUTO_SEO_LOAD_FAILED",
            err,
          );
        }
      });
    }

    return productIds.map((id) => {
      const product = productMap.get(id);
      if (!product) {
        throw new AppError(
          `Failed to hydrate product detail for product ${id}: product detail not found`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }
      return product;
    });
  }

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    try {
      return await runAutoSeo(input);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Auto SEO execution failed.",
        "AUTO_SEO_RUN_FAILED",
        error,
      );
    }
  }
}

export const realAutoSeoClient = new RealAutoSeoClient();
