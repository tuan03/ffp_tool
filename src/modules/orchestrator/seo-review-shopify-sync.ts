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
  type ShopifyMetafieldInput,
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
  readonly tags?: readonly string[];
  readonly vendor?: string;
  readonly productType?: string;
  readonly metafields?: readonly ShopifyMetafieldInput[];
  readonly originalStoreId?: string;
  readonly collectionsToJoin?: readonly string[];
  readonly variants?: readonly {
    readonly title?: string;
    readonly price: string;
    readonly compareAtPrice?: string;
    readonly sku?: string;
    readonly barcode?: string;
    readonly inventoryTracked?: boolean;
    readonly optionValues?: readonly {
      readonly optionName?: string;
      readonly name?: string;
      readonly value?: string;
    }[];
  }[];
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
    const isCrossStore = Boolean(
      product.originalStoreId &&
      product.originalStoreId.trim().toLowerCase() !== targetStoreId.trim().toLowerCase(),
    );

    let finalMetafields = product.metafields ? [...product.metafields] : undefined;

    // By default, always upload the print master file to Shopify Files so it has a permanent Shopify CDN URL!
    if (finalMetafields && finalMetafields.length > 0) {
      const printUrlMetaIndex = finalMetafields.findIndex(
        (m) => m.namespace === "custom" && m.key === "print_file_url" && Boolean(m.value && m.value.trim()),
      );

      if (printUrlMetaIndex >= 0) {
        const rawPrintSource = finalMetafields[printUrlMetaIndex].value.trim();
        try {
          const rawFilename = rawPrintSource.split("/").pop()?.split("?")[0] || `${product.handle}-print-master.png`;
          const uploadGateway = createShopifyGatewayAdapter(targetStoreId, {
            runner: moduleApiRunner,
            mode,
            getRequestId: (op) => `seo-review-upload-${product.id}-${op}-${Date.now()}`,
          });

          const uploaded = await uploadGateway.uploadFile({
            originalSource: rawPrintSource,
            filename: rawFilename,
            contentType: "FILE",
            alt: `${product.productTitle} - High Resolution Print Graphic (300 DPI)`,
          });

          if (uploaded?.shopifyCdnUrl) {
            const cdnUrl = uploaded.shopifyCdnUrl;
            const fileId = uploaded.fileId;

            finalMetafields[printUrlMetaIndex] = {
              ...finalMetafields[printUrlMetaIndex],
              value: cdnUrl,
            };

            const printSpecsIndex = finalMetafields.findIndex(
              (m) => m.namespace === "custom" && m.key === "print_specs" && Boolean(m.value),
            );
            if (printSpecsIndex >= 0) {
              try {
                const parsed = JSON.parse(finalMetafields[printSpecsIndex].value) as Record<string, unknown>;
                parsed.shopifyCdnUrl = cdnUrl;
                if (fileId) parsed.shopifyFileId = fileId;
                parsed.cmykUrl = cdnUrl;
                parsed.rgbUrl = cdnUrl;
                finalMetafields[printSpecsIndex] = {
                  ...finalMetafields[printSpecsIndex],
                  value: JSON.stringify(parsed),
                };
              } catch {
                // ignore json error
              }
            }
          }
        } catch (uploadError) {
          console.warn("[Shopify Sync] Could not upload print file to Shopify Files, using original source:", uploadError);
        }
      }
    }

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
      const rawCandidateId = normalizeShopifyProductGid(product.productId) || normalizeShopifyProductGid(crawlShopifyId);
      // When syncing cross-store, previous store's Product ID is invalid on the target store
      const candidateShopifyId = isCrossStore ? undefined : rawCandidateId;

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

      const sourceKey = candidateSourceKeys[0] || (typeof product.asin === "string" ? product.asin.trim() : "") || product.handle;
      if (sourceKey || product.handle) {
        try {
          const resolved = await resolveShopifyProductForSync({
            runner: moduleApiRunner,
            storeId: targetStoreId,
            sourceKey: sourceKey || product.handle,
            mappedProductId: candidateShopifyId,
            handle: product.handle,
          });
          if (resolved.product) {
            existingProductId = resolved.product.id;
            existingManagedResources = {
              tags: resolved.product.tags,
              mediaIds: resolved.product.images?.flatMap((img) => (img.id ? [img.id] : [])) ?? [],
              variantIds: resolved.product.variants?.map((v) => v.id) ?? [],
            };
          } else if (resolved.match === "none") {
            existingProductId = undefined;
          }
        } catch {
          if (isCrossStore) {
            existingProductId = undefined;
          }
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

      const finalProductId = syncResult.productId || validExistingProductId || (isCrossStore ? undefined : normalizeShopifyProductGid(product.productId));
      const finalHandle = syncResult.productHandle || product.handle;

      return {
        id: product.id,
        success: true,
        productId: finalProductId,
        productHandle: finalHandle,
        adminUrl: buildShopifyAdminUrl(shopAdminHandle, finalProductId),
      };
    }

    // Case 2: Product has existing Shopify Product ID or matches handle on target store
    let crossStoreExistingId: string | undefined;
    if (isCrossStore && product.handle) {
      try {
        const handleCheck = (await moduleApiRunner({
          storeId: targetStoreId,
          operation: "products.list",
          payload: {
            limit: 1,
            query: `handle:${product.handle.trim()}`,
          },
        })) as { data?: { products?: readonly { id: string; handle: string }[] } };
        const matched = handleCheck.data?.products?.find(
          (p) => p.handle.toLowerCase() === product.handle.trim().toLowerCase(),
        );
        if (matched) {
          crossStoreExistingId = matched.id;
        }
      } catch {
        // ignore
      }
    }

    const normalizedProductId = (isCrossStore ? undefined : normalizeShopifyProductGid(product.productId)) || crossStoreExistingId;
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

      if (finalMetafields && finalMetafields.length > 0 && finalProductId) {
        try {
          await moduleApiRunner({
            storeId: targetStoreId,
            operation: "metafields.set",
            mode,
            requestId: `seo-review-metafields-${product.id}-${Date.now()}`,
            payload: {
              ownerId: finalProductId,
              metafields: finalMetafields.map((m) => ({
                ...m,
                ownerId: finalProductId,
              })),
            },
          });
        } catch {
          // Gracefully continue so product sync remains successful
        }
      }

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
      tags: product.tags ? [...product.tags] : undefined,
      vendor: product.vendor,
      productType: product.productType,
      collectionsToJoin: product.collectionsToJoin,
      metafields: finalMetafields,
      media: product.images.map((img) => ({
        originalSource: img.previewUrl,
        alt: img.alt,
        mediaContentType: "IMAGE",
      })),
      variants: product.variants?.map((v) => ({
        title: v.title,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        sku: v.sku,
        barcode: v.barcode,
        inventoryTracked: v.inventoryTracked,
        optionValues: v.optionValues?.map((ov) => ({
          optionName: ov.optionName || "Size",
          name: ov.name || ov.value || "Standard",
        })),
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
