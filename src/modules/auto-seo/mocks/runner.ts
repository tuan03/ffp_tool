import { AppError } from "../../../shared/errors/app-error";
import { mapWithConcurrency, runAutoSeo } from "../service";
import type {
  AutoSeoBackupRequest,
  AutoSeoBackupResponse,
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  AutoSeoStoreOption,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { autoSeoMockProducts, mockShopifyProducts } from "./data";

export const mockAutoSeoStores: readonly AutoSeoStoreOption[] = [
  {
    storeId: "store-chillgen-mock",
    shopDomain: "chillgen-mock.myshopify.com",
  },
  {
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
  },
];

function cloneMockProduct(
  product: AutoSeoProductCandidate,
): AutoSeoProductCandidate {
  return {
    ...product,
    images: product.images.map((image) => ({ ...image })),
  };
}

export async function runMockAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const products =
    input.products.length > 0
      ? input.products
      : autoSeoMockProducts.map(cloneMockProduct);

  return runAutoSeo({
    workflowId: input.workflowId,
    products,
    selectedProductIds: input.selectedProductIds,
    selectedHandles: input.selectedHandles,
  });
}

export class MockAutoSeoClient implements AutoSeoClient {
  private readonly detailCache = new Map<string, ShopifyProductForAutoSeoUi>();
  private activeStoreId = "store-chillgen-mock";

  public async listStores(): Promise<readonly AutoSeoStoreOption[]> {
    return JSON.parse(JSON.stringify(mockAutoSeoStores)) as AutoSeoStoreOption[];
  }

  public setActiveStoreId(storeId: string): void {
    this.activeStoreId = storeId.trim();
  }

  public getActiveStoreId(): string | undefined {
    return this.activeStoreId;
  }

  public getCachedDetail(productId: string): ShopifyProductForAutoSeoUi | undefined {
    const cached = this.detailCache.get(productId);
    return cached ? (JSON.parse(JSON.stringify(cached)) as ShopifyProductForAutoSeoUi) : undefined;
  }

  public clearDetailCache(): void {
    this.detailCache.clear();
  }

  public clearCache(): void {
    this.clearDetailCache();
    this.activeStoreId = "store-chillgen-mock";
  }

  public async loadProducts(storeId?: string): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    const targetStoreId = (storeId ?? this.activeStoreId).trim();
    if (targetStoreId === "capozen") {
      const capozenProducts = mockShopifyProducts.map((p) => ({
        ...(JSON.parse(JSON.stringify(p)) as ShopifyProductForAutoSeoUi),
        vendor: "Capozen",
        title: `[Capozen] ${p.title}`,
      }));
      return capozenProducts;
    }
    return JSON.parse(JSON.stringify(mockShopifyProducts)) as ShopifyProductForAutoSeoUi[];
  }

  public async getStoreInfo(storeId?: string): Promise<{ storeId: string; shopDomain: string }> {
    const targetStoreId = (storeId ?? this.activeStoreId).trim();
    const matched = mockAutoSeoStores.find((s) => s.storeId === targetStoreId);
    if (matched) {
      return {
        storeId: matched.storeId,
        shopDomain: matched.shopDomain,
      };
    }
    return {
      storeId: targetStoreId || "store-chillgen-mock",
      shopDomain: `${targetStoreId || "chillgen-mock"}.myshopify.com`,
    };
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
      return JSON.parse(JSON.stringify(cached)) as ShopifyProductForAutoSeoUi;
    }

    return this.loadProductDetailFresh(productId);
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
    const productId = isStoreIdExplicit ? maybeProductId! : productIdOrStoreId;

    if (!productId || typeof productId !== "string" || productId.trim() === "") {
      throw new AppError("Product ID is required to load product detail", "AUTO_SEO_LOAD_FAILED");
    }

    const product = mockShopifyProducts.find((p) => p.id === productId);
    if (!product) {
      throw new AppError(`Product not found: ${productId}`, "AUTO_SEO_LOAD_FAILED");
    }

    const cloned = JSON.parse(JSON.stringify(product)) as ShopifyProductForAutoSeoUi;
    this.detailCache.set(productId, cloned);
    return JSON.parse(JSON.stringify(cloned)) as ShopifyProductForAutoSeoUi;
  }

  public async hydrateSelectedProducts(
    productIds: readonly string[],
    concurrency = 5,
    _storeId?: string,
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
      return JSON.parse(JSON.stringify(product)) as ShopifyProductForAutoSeoUi;
    });
  }

  public async hydrateSelectedProductsFresh(
    productIds: readonly string[],
    concurrency = 5,
    _storeId?: string,
  ): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(productIds));
    const productMap = new Map<string, ShopifyProductForAutoSeoUi>();

    await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
      const detail = await this.loadProductDetailFresh(id);
      productMap.set(id, detail);
    });

    return productIds.map((id) => {
      const product = productMap.get(id);
      if (!product) {
        throw new AppError(
          `Failed to hydrate product detail for product ${id}: product detail not found`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }
      return JSON.parse(JSON.stringify(product)) as ShopifyProductForAutoSeoUi;
    });
  }

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    return runAutoSeo(input);
  }

  public async runAutoSeoBackup(
    request: AutoSeoBackupRequest,
  ): Promise<AutoSeoBackupResponse> {
    return {
      workflowId: request.workflowId,
      backedUpCount: request.products.length,
      backupIds: request.products.map((_, idx) => `mock_backup_${idx + 1}`),
      downstreamStatus: "SENT",
      downstreamHttpStatus: 200,
      downstreamError: null,
    };
  }
}

export const mockAutoSeoClient = new MockAutoSeoClient();
