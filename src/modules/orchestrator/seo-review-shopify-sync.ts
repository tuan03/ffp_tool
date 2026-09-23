import type { CrawlProduct } from "../customization-normalizer";
import {
  createShopifyGatewayAdapter,
  isShopifyProductGid,
  normalizeShopifyProductGid,
  resolveShopifyProductForSync,
  type ModuleApiRunner,
  type ShopifyProductsUpdateResponse,
} from "../module-api";
import {
  applySeoContentToCustomizationProduct,
  type SeoContentOutput,
} from "../seo-content";
import {
  fromCustomizationNormalizerProduct,
  syncSingleProduct,
  type ShopifyManagedResources,
} from "../shopify-sync";

export interface SeoReviewPushImageItem {
  readonly id?: string;
  readonly previewUrl: string;
  readonly alt: string;
  readonly webpFilename?: string;
  readonly webpUrl?: string;
}

export interface SeoReviewPushProductItem {
  readonly id: string;
  readonly productId?: string;
  readonly asin?: string;
  readonly productTitle: string;
  readonly productDescription: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly handle: string;
  readonly images: readonly SeoReviewPushImageItem[];
  readonly sourceCrawlProduct?: CrawlProduct;
}

export interface PushSeoReviewProductResult {
  readonly id: string;
  readonly success: boolean;
  readonly productId?: string;
  readonly productHandle?: string;
  readonly adminUrl?: string;
  readonly error?: string;
}

export interface PushSeoReviewProductsOptions {
  readonly moduleApiRunner: ModuleApiRunner;
  readonly storeId?: string;
  readonly mode?: "apply" | "preview";
}

export interface ResolvedShopifyStoreInfo {
  readonly storeId: string;
  readonly shopAdminHandle: string;
}

export function buildShopifyAdminUrl(shopAdminHandle: string, productId?: string): string | undefined {
  if (!productId || typeof productId !== "string") return undefined;
  const cleanId = productId.trim();
  const numericId = cleanId.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!numericId) return undefined;
  const cleanHandle = shopAdminHandle.trim().replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${cleanHandle}/products/${numericId}`;
}

export async function resolvePrimaryShopifyStore(
  moduleApiRunner: ModuleApiRunner,
  preferredStoreId?: string,
): Promise<ResolvedShopifyStoreInfo> {
  const cleanPreferred = preferredStoreId?.trim();
  try {
    const listResponse = await moduleApiRunner({
      operation: "stores.list",
      payload: {},
    });
    const stores = listResponse?.data?.stores ?? [];
    if (cleanPreferred) {
      const match = stores.find((s) => s.storeId === cleanPreferred);
      if (match && typeof match.shopDomain === "string" && match.shopDomain.trim() !== "") {
        const cleanDomain = match.shopDomain.trim();
        const handle = cleanDomain.replace(/\.myshopify\.com$/i, "");
        return { storeId: match.storeId, shopAdminHandle: handle };
      }
    }
    const firstStore = stores[0];
    if (firstStore && typeof firstStore.storeId === "string" && firstStore.storeId.trim() !== "") {
      const cleanDomain = (firstStore.shopDomain || firstStore.storeId).trim();
      const handle = cleanDomain.replace(/\.myshopify\.com$/i, "");
      return { storeId: firstStore.storeId, shopAdminHandle: handle };
    }
  } catch {
    // Fall back to default store if stores.list is unsupported or fails
  }

  const fallbackStore = cleanPreferred || "capozen";
  const fallbackHandle = fallbackStore.replace(/\.myshopify\.com$/i, "");
  return { storeId: fallbackStore, shopAdminHandle: fallbackHandle };
}

export async function pushSeoReviewProductToShopify(
  product: SeoReviewPushProductItem,
  options: PushSeoReviewProductsOptions,
  resolvedStore?: ResolvedShopifyStoreInfo,
): Promise<PushSeoReviewProductResult> {
  const { moduleApiRunner, mode = "apply" } = options;

  try {
    const store = resolvedStore || (await resolvePrimaryShopifyStore(moduleApiRunner, options.storeId));
    const targetStoreId = store.storeId;
    const shopAdminHandle = store.shopAdminHandle;

    // Case 1: Product has full crawled product data from Amazon Crawler
    if (product.sourceCrawlProduct) {
      const crawl = product.sourceCrawlProduct;
      const seoOutput: SeoContentOutput = {
        productTitle: product.productTitle,
        productDescription: product.productDescription,
        productSeoTitle: product.seoTitle,
        productSeoDescription: product.seoDescription,
        productHandle: product.handle,
        images: product.images.map((img) => ({
          sourceUrl: img.previewUrl,
          alt: img.alt,
          webp: {
            filename: img.webpFilename || `${product.handle}-${img.id}.webp`,
            url: img.webpUrl || img.previewUrl,
          },
        })),
      };

      const enrichedCrawlProduct = applySeoContentToCustomizationProduct(crawl, seoOutput, {
        ensureUniqueHandle: false,
      });

      const gateway = createShopifyGatewayAdapter(targetStoreId, {
        runner: moduleApiRunner,
        mode,
        getRequestId: (op) => `seo-review-${product.id}-${op}-${Date.now()}`,
      });

      // 1. Identify any existing valid Shopify Product GID
      const crawlPipelineShopify = crawl as {
        pipeline?: { shopify?: { productId?: string } };
        shopify?: { productId?: string };
      };
      const crawlShopifyId = crawlPipelineShopify.pipeline?.shopify?.productId || crawlPipelineShopify.shopify?.productId;
      const candidateShopifyId = normalizeShopifyProductGid(product.productId) || normalizeShopifyProductGid(crawlShopifyId);

      // 2. Discover/reconcile existing Shopify product via sourceKey or mapping
      let existingProductId: string | undefined = candidateShopifyId;
      let existingManagedResources: ShopifyManagedResources | undefined;

      const candidateSourceKeys = [
        typeof crawl.sourceKey === "string" ? crawl.sourceKey.trim() : "",
        typeof crawl.asin === "string" ? crawl.asin.trim() : "",
        typeof crawl.parentAsin === "string" ? crawl.parentAsin.trim() : "",
        typeof product.asin === "string" ? product.asin.trim() : "",
        typeof crawl.id === "string" ? crawl.id.trim() : "",
        typeof product.id === "string" ? product.id.trim() : "",
      ].filter((k) => k.length > 0 && !k.startsWith("sample-prod-") && !k.startsWith("crawler-review-"));

      const sourceKey = candidateSourceKeys[0];
      if (sourceKey) {
        try {
          const resolved = await resolveShopifyProductForSync({
            runner: moduleApiRunner,
            storeId: targetStoreId,
            sourceKey,
            mappedProductId: candidateShopifyId,
          });
          if (resolved.product) {
            existingProductId = resolved.product.id;
            existingManagedResources = {
              tags: resolved.product.tags,
              mediaIds: resolved.product.images?.flatMap((img) => (img.id ? [img.id] : [])) ?? [],
              variantIds: resolved.product.variants?.map((v) => v.id) ?? [],
            };
          } else if (resolved.match === "none" && !candidateShopifyId) {
            existingProductId = undefined;
          }
        } catch {
          // If resolution fails (e.g. offline/mock runner), proceed with candidateShopifyId if valid
        }
      }

      // Ensure existingProductId is strictly a valid Shopify GID or undefined (never pass raw ASIN)
      const validExistingProductId = isShopifyProductGid(existingProductId) ? existingProductId : undefined;

      const syncResult = await syncSingleProduct(fromCustomizationNormalizerProduct(enrichedCrawlProduct), {
        gateway,
        existingProductId: validExistingProductId,
        existingManagedResources,
      });

      if (!syncResult.success) {
        return {
          id: product.id,
          success: false,
          error: syncResult.error || "Failed to push product to Shopify via shopify-sync adapter.",
        };
      }

      const finalProductId = syncResult.productId || validExistingProductId || normalizeShopifyProductGid(product.productId);
      const finalHandle = syncResult.productHandle || product.handle;

      return {
        id: product.id,
        success: true,
        productId: finalProductId,
        productHandle: finalHandle,
        adminUrl: buildShopifyAdminUrl(shopAdminHandle, finalProductId),
      };
    }

    // Case 2: Product has existing Shopify Product ID (e.g. from Auto SEO or prior sync)
    const normalizedProductId = normalizeShopifyProductGid(product.productId);
    if (normalizedProductId) {
      const response = (await moduleApiRunner({
        storeId: targetStoreId,
        mode,
        requestId: `seo-review-update-${product.id}-${Date.now()}`,
        operation: "products.update",
        payload: {
          id: normalizedProductId,
          product: {
            title: product.productTitle,
            descriptionHtml: product.productDescription,
            handle: product.handle,
            seo: {
              title: product.seoTitle,
              description: product.seoDescription,
            },
            images: product.images.map((img) => ({
              id: img.id && img.id.startsWith("gid://shopify/") ? img.id : undefined,
              src: img.previewUrl,
              altText: img.alt,
            })),
          },
        },
      })) as ShopifyProductsUpdateResponse;

      if (!response || response.success !== true) {
        return {
          id: product.id,
          success: false,
          error: "Shopify API returned unsuccessful update status.",
        };
      }

      const updated = response.data.product;
      const finalProductId = updated?.id || normalizedProductId;
      const finalHandle = updated?.handle || product.handle;

      return {
        id: product.id,
        success: true,
        productId: finalProductId,
        productHandle: finalHandle,
        adminUrl: buildShopifyAdminUrl(shopAdminHandle, finalProductId),
      };
    }

    // Case 3: Standalone product without crawl data or existing Shopify ID -> create new product
    const gateway = createShopifyGatewayAdapter(targetStoreId, {
      runner: moduleApiRunner,
      mode,
      getRequestId: (op) => `seo-review-create-${product.id}-${op}-${Date.now()}`,
    });

    const created = await gateway.createProduct({
      title: product.productTitle,
      descriptionHtml: product.productDescription,
      handle: product.handle,
      seo: {
        title: product.seoTitle,
        description: product.seoDescription,
      },
      media: product.images.map((img) => ({
        originalSource: img.previewUrl,
        alt: img.alt,
        mediaContentType: "IMAGE",
      })),
      status: "ACTIVE",
    });

    const finalProductId = created.productId;
    const finalHandle = created.productHandle;

    return {
      id: product.id,
      success: true,
      productId: finalProductId,
      productHandle: finalHandle,
      adminUrl: buildShopifyAdminUrl(shopAdminHandle, finalProductId),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: product.id,
      success: false,
      error: message,
    };
  }
}

export async function pushSeoReviewProductsBatch(
  products: readonly SeoReviewPushProductItem[],
  options: PushSeoReviewProductsOptions,
  concurrency = 3,
): Promise<readonly PushSeoReviewProductResult[]> {
  if (products.length === 0) return [];

  const store = await resolvePrimaryShopifyStore(options.moduleApiRunner, options.storeId);
  const results: PushSeoReviewProductResult[] = [];
  const safeConcurrency = Math.max(1, Math.min(concurrency, 6));

  for (let index = 0; index < products.length; index += safeConcurrency) {
    const chunk = products.slice(index, index + safeConcurrency);
    const chunkResults = await Promise.all(
      chunk.map((prod) => pushSeoReviewProductToShopify(prod, options, store)),
    );
    results.push(...chunkResults);
  }

  return results;
}
