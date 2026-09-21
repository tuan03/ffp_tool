import { AppError } from "../../../shared/errors/app-error";
import { mapWithConcurrency, runAutoSeo } from "../service";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { autoSeoMockProducts, mockShopifyProducts } from "./data";

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

  public getCachedDetail(productId: string): ShopifyProductForAutoSeoUi | undefined {
    const cached = this.detailCache.get(productId);
    return cached ? (JSON.parse(JSON.stringify(cached)) as ShopifyProductForAutoSeoUi) : undefined;
  }

  public clearDetailCache(): void {
    this.detailCache.clear();
  }

  public clearCache(): void {
    this.clearDetailCache();
  }

  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    return JSON.parse(JSON.stringify(mockShopifyProducts)) as ShopifyProductForAutoSeoUi[];
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

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    return runAutoSeo(input);
  }
}

export const mockAutoSeoClient = new MockAutoSeoClient();
