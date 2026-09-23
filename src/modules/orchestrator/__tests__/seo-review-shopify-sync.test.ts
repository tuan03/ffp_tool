import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import type { CrawlProduct } from "../../customization-normalizer";
import type { ModuleApiRunner, ShopifyApiInput, ShopifyApiResponse } from "../../module-api";
import {
  buildShopifyAdminUrl,
  pushSeoReviewProductsBatch,
  pushSeoReviewProductToShopify,
  resolvePrimaryShopifyStore,
  type SeoReviewPushProductItem,
} from "../seo-review-shopify-sync";

function createMockRunner(
  handler?: (input: ShopifyApiInput) => Promise<ShopifyApiResponse | undefined>,
): ModuleApiRunner {
  const runner = async (input: ShopifyApiInput): Promise<ShopifyApiResponse> => {
    if (handler) {
      const custom = await handler(input);
      if (custom) return custom;
    }

    if (input.operation === "stores.list") {
      return {
        storeId: "capozen",
        operation: "stores.list",
        success: true,
        data: {
          stores: [
            {
              storeId: "capozen",
              shopDomain: "capozen.myshopify.com",
              apiVersion: "2026-07",
              authType: "static",
              connected: true,
            },
          ],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.update") {
      return {
        storeId: input.storeId || "capozen",
        operation: "products.update",
        success: true,
        data: {
          product: {
            id: input.payload.id,
            title: input.payload.product.title || "Updated Title",
            handle: input.payload.product.handle || "updated-handle",
            descriptionHtml: input.payload.product.descriptionHtml,
          },
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.create") {
      return {
        storeId: input.storeId || "capozen",
        operation: "products.create",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/new-created-999",
            title: input.payload.product.title,
            handle: input.payload.product.handle || "new-product",
          },
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      return {
        storeId: input.storeId || "capozen",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: input.payload.id,
            title: "Existing Product",
            handle: "existing-product",
            variants: [],
            images: [],
          },
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "files.create") {
      const filename = input.payload?.filename || "print-file.png";
      return {
        storeId: input.storeId || "capozen",
        operation: "files.create",
        success: true,
        data: {
          fileId: "gid://shopify/GenericFile/file-777",
          shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${filename}`,
          fileStatus: "READY",
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "metafields.set") {
      return {
        storeId: input.storeId || "capozen",
        operation: "metafields.set",
        success: true,
        data: {
          success: true,
          metafieldId: "gid://shopify/Metafield/meta-123",
        },
      } as unknown as ShopifyApiResponse;
    }

    return {
      storeId: "capozen",
      operation: input.operation,
      success: true,
      data: {},
    } as unknown as ShopifyApiResponse;
  };
  return runner as unknown as ModuleApiRunner;
}

describe("seo-review-shopify-sync", () => {
  it("builds correct Shopify admin product URL", () => {
    assert.equal(
      buildShopifyAdminUrl("capozen", "gid://shopify/Product/12345678"),
      "https://admin.shopify.com/store/capozen/products/12345678",
    );
    assert.equal(
      buildShopifyAdminUrl("capozen.myshopify.com", "gid://shopify/Product/888"),
      "https://admin.shopify.com/store/capozen/products/888",
    );
    assert.equal(buildShopifyAdminUrl("capozen", ""), undefined);
    assert.equal(buildShopifyAdminUrl("capozen", undefined), undefined);
  });

  it("resolves primary store from stores.list", async () => {
    const runner = createMockRunner();
    const resolved = await resolvePrimaryShopifyStore(runner);
    assert.equal(resolved.storeId, "capozen");
    assert.equal(resolved.shopAdminHandle, "capozen");
  });

  it("pushes existing Auto SEO product using products.update and returns adminUrl", async () => {
    const executedInputs: ShopifyApiInput[] = [];
    const runner = createMockRunner(async (input) => {
      executedInputs.push(input);
      if (input.operation === "stores.list") {
        return {
          storeId: "capozen",
          operation: "stores.list",
          success: true,
          data: {
            stores: [{ storeId: "capozen", shopDomain: "capozen.myshopify.com", connected: true }],
            total: 1,
          },
        } as unknown as ShopifyApiResponse;
      }
      if (input.operation === "products.update") {
        return {
          storeId: "capozen",
          operation: "products.update",
          success: true,
          data: {
            product: {
              id: input.payload.id,
              title: input.payload.product.title,
              handle: input.payload.product.handle,
            },
          },
        } as unknown as ShopifyApiResponse;
      }
      return { storeId: "capozen", operation: input.operation, success: true, data: {} } as unknown as ShopifyApiResponse;
    });

    const item: SeoReviewPushProductItem = {
      id: "auto-seo-101",
      productId: "gid://shopify/Product/98412351",
      productTitle: "Approved Ceramic Mug",
      productDescription: "<p>Optimized Description</p>",
      seoTitle: "Best Ceramic Mug | Custom Print",
      seoDescription: "High quality ceramic mug with durable print.",
      handle: "approved-ceramic-mug",
      images: [
        {
          id: "gid://shopify/ProductImage/111",
          previewUrl: "https://example.com/mug.png",
          alt: "Ceramic Mug Front View",
        },
      ],
    };

    const result = await pushSeoReviewProductToShopify(item, { moduleApiRunner: runner });

    assert.equal(result.success, true);
    assert.equal(result.productId, "gid://shopify/Product/98412351");
    assert.equal(result.productHandle, "approved-ceramic-mug");
    assert.equal(result.adminUrl, "https://admin.shopify.com/store/capozen/products/98412351");

    const updateCall = executedInputs.find((i) => i.operation === "products.update");
    assert.ok(updateCall);
    if (updateCall && updateCall.operation === "products.update") {
      assert.equal(updateCall.payload.id, "gid://shopify/Product/98412351");
      assert.equal(updateCall.payload.product.title, "Approved Ceramic Mug");
      assert.equal(updateCall.payload.product.seo?.title, "Best Ceramic Mug | Custom Print");
      assert.equal(updateCall.payload.product.images?.[0]?.altText, "Ceramic Mug Front View");
    }
  });

  it("pushes Amazon Crawler product with sourceCrawlProduct using shopify-sync adapter", async () => {
    const runner = createMockRunner(async (input) => {
      if (input.operation === "stores.list") {
        return {
          storeId: "capozen",
          operation: "stores.list",
          success: true,
          data: {
            stores: [{ storeId: "capozen", shopDomain: "capozen.myshopify.com", connected: true }],
            total: 1,
          },
        } as unknown as ShopifyApiResponse;
      }
      if (input.operation === "products.create") {
        return {
          storeId: "capozen",
          operation: "products.create",
          success: true,
          data: {
            product: {
              id: "gid://shopify/Product/crawl-sync-777",
              title: input.payload.product.title,
              handle: input.payload.product.handle || "crawl-product-handle",
              variants: [{ id: "gid://shopify/ProductVariant/v1", price: "29.99" }],
              images: [],
            },
          },
        } as unknown as ShopifyApiResponse;
      }
      return undefined;
    });

    const mockCrawlProduct: CrawlProduct = {
      id: "amazon-asin-1",
      asin: "B00EXAMPLE",
      title: "Raw Amazon Title",
      description: "Raw Amazon Description",
      variants: [
        {
          id: "var-1",
          sku: "SKU-1",
          price: 29.99,
          options: [{ name: "Size", value: "Standard" }],
        },
      ],
      media: [
        {
          kind: "image",
          url: "https://images-na.ssl-images-amazon.com/img1.jpg",
          alt: "Raw Alt",
        },
      ],
    };

    const item: SeoReviewPushProductItem = {
      id: "crawler-review-1",
      productTitle: "Enriched Custom Blanket",
      productDescription: "<p>Ultra soft custom photo blanket.</p>",
      seoTitle: "Custom Photo Blanket | Cozy Living",
      seoDescription: "Personalized fleece blankets with vibrant print.",
      handle: "custom-photo-blanket",
      images: [
        {
          previewUrl: "https://images-na.ssl-images-amazon.com/img1.jpg",
          alt: "Customized Photo Blanket on Sofa",
        },
      ],
      sourceCrawlProduct: mockCrawlProduct,
    };

    const result = await pushSeoReviewProductToShopify(item, { moduleApiRunner: runner });
    if (!result.success) {
      console.error("DEBUG SYNC ERROR:", result.error);
    }

    assert.equal(result.success, true);
    assert.equal(result.productId, "gid://shopify/Product/crawl-sync-777");
    assert.equal(result.adminUrl, "https://admin.shopify.com/store/capozen/products/crawl-sync-777");
  });

  it("handles errors gracefully and returns success: false with descriptive message", async () => {
    const errorRunner: ModuleApiRunner = (async (input: ShopifyApiInput) => {
      if (input.operation === "stores.list") {
        return {
          storeId: "capozen",
          operation: "stores.list",
          success: true,
          data: { stores: [{ storeId: "capozen", shopDomain: "capozen.myshopify.com" }] },
        } as unknown as ShopifyApiResponse;
      }
      throw new Error("Shopify Gateway timeout 504 Gateway Timeout");
    }) as unknown as ModuleApiRunner;

    const item: SeoReviewPushProductItem = {
      id: "fail-item-1",
      productId: "gid://shopify/Product/9999",
      productTitle: "Failing Product",
      productDescription: "<p>Desc</p>",
      seoTitle: "Title",
      seoDescription: "Desc",
      handle: "fail-product",
      images: [],
    };

    const result = await pushSeoReviewProductToShopify(item, { moduleApiRunner: errorRunner });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Shopify Gateway timeout 504"));
  });

  it("pushes batch of products concurrently", async () => {
    const runner = createMockRunner();
    const items: SeoReviewPushProductItem[] = [
      {
        id: "prod-1",
        productId: "gid://shopify/Product/1",
        productTitle: "Prod 1",
        productDescription: "Desc 1",
        seoTitle: "SEO 1",
        seoDescription: "SEO Desc 1",
        handle: "prod-1",
        images: [],
      },
      {
        id: "prod-2",
        productId: "gid://shopify/Product/2",
        productTitle: "Prod 2",
        productDescription: "Desc 2",
        seoTitle: "SEO 2",
        seoDescription: "SEO Desc 2",
        handle: "prod-2",
        images: [],
      },
    ];

    const results = await pushSeoReviewProductsBatch(items, { moduleApiRunner: runner }, 2);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.success, true);
    assert.equal(results[0]?.productId, "gid://shopify/Product/1");
    assert.equal(results[1]?.success, true);
    assert.equal(results[1]?.productId, "gid://shopify/Product/2");
  });

  it("safely handles raw ASIN in product.productId without crashing with invalid ID error, creating product", async () => {
    const executedOperations: string[] = [];
    const runner = createMockRunner(async (input) => {
      executedOperations.push(input.operation);
      if (input.operation === "products.get") {
        const id = (input.payload as { id?: string }).id;
        if (id && !id.startsWith("gid://shopify/")) {
          throw new Error(`Variable $id of type ID! was provided invalid value "${id}"`);
        }
      }
      if (input.operation === "products.list") {
        return {
          storeId: "capozen",
          operation: "products.list",
          success: true,
          data: { products: [] },
        } as unknown as ShopifyApiResponse;
      }
      return undefined;
    });

    const mockCrawlProduct: CrawlProduct = {
      id: "B0H829WFC2",
      asin: "B0H829WFC2",
      title: "Classroom Shaped Rug",
      description: "Personalized notebook rug",
      variants: [],
      media: [],
    };

    const item: SeoReviewPushProductItem = {
      id: "crawler-review-asin-1",
      productId: "B0H829WFC2", // ASIN passed from crawler/UI
      productTitle: "Personalized Composition Notebook Classroom Shaped Rug",
      productDescription: "<p>Durable classroom rug.</p>",
      seoTitle: "Personalized Notebook Rug",
      seoDescription: "Custom shaped rug for classrooms.",
      handle: "personalized-composition-notebook-classroom-shaped-rug",
      images: [],
      sourceCrawlProduct: mockCrawlProduct,
    };

    const result = await pushSeoReviewProductToShopify(item, { moduleApiRunner: runner });

    assert.equal(result.success, true);
    assert.equal(result.productId, "gid://shopify/Product/new-created-999");
    assert.ok(executedOperations.includes("products.create"));
  });

  it("reconciles existing Shopify product via source tag when crawled product was already synced by Distributed Crawler", async () => {
    const existingShopifyProduct = {
      id: "gid://shopify/Product/existing-synced-555",
      title: "Personalized Composition Notebook Classroom Shaped Rug",
      handle: "personalized-composition-notebook-classroom-shaped-rug",
      tags: ["ffp-source:amazon:B0H829WFC2:none:none"],
      variants: [{ id: "gid://shopify/ProductVariant/v555", price: "45.00" }],
      images: [{ id: "gid://shopify/ProductImage/img555", src: "https://example.com/rug.jpg" }],
    };

    let didUpdateExisting = false;
    const runner = createMockRunner(async (input) => {
      if (input.operation === "products.list") {
        return {
          storeId: "capozen",
          operation: "products.list",
          success: true,
          data: { products: [existingShopifyProduct] },
        } as unknown as ShopifyApiResponse;
      }
      if (input.operation === "products.get") {
        const id = (input.payload as { id?: string }).id;
        if (id === existingShopifyProduct.id) {
          return {
            storeId: "capozen",
            operation: "products.get",
            success: true,
            data: { product: existingShopifyProduct },
          } as unknown as ShopifyApiResponse;
        }
      }
      if (input.operation === "products.update") {
        if (input.payload.id === existingShopifyProduct.id) {
          didUpdateExisting = true;
          return {
            storeId: "capozen",
            operation: "products.update",
            success: true,
            data: {
              product: {
                ...existingShopifyProduct,
                title: input.payload.product.title,
              },
            },
          } as unknown as ShopifyApiResponse;
        }
      }
      return undefined;
    });

    const mockCrawlProduct: CrawlProduct = {
      id: "B0H829WFC2",
      asin: "B0H829WFC2",
      sourceKey: "amazon:B0H829WFC2:none:none",
      title: "Classroom Shaped Rug",
      description: "Personalized notebook rug",
      variants: [{ id: "v1", price: 45.0 }],
      media: [],
    };

    const item: SeoReviewPushProductItem = {
      id: "crawler-review-asin-2",
      productId: "B0H829WFC2", // ASIN passed from crawler/UI
      productTitle: "Updated Approved Rug Title",
      productDescription: "<p>Updated description</p>",
      seoTitle: "Updated SEO Title",
      seoDescription: "Updated SEO Description",
      handle: "personalized-composition-notebook-classroom-shaped-rug",
      images: [],
      sourceCrawlProduct: mockCrawlProduct,
    };

    const result = await pushSeoReviewProductToShopify(item, { moduleApiRunner: runner });

    assert.equal(result.success, true);
    assert.equal(result.productId, "gid://shopify/Product/existing-synced-555");
    assert.equal(didUpdateExisting, true);
  });

  it("pushes Pinterest POD product with printMaster metafields and only AI mockups in media", async () => {
    let capturedMetafields: unknown[] | undefined;
    let capturedMedia: unknown[] | undefined;

    const runner = createMockRunner(async (input) => {
      if (input.operation === "products.create") {
        const payload = input.payload as { product?: { metafields?: unknown[]; media?: unknown[] } };
        capturedMetafields = payload.product?.metafields;
        capturedMedia = payload.product?.media;
        return {
          storeId: "capozen",
          operation: "products.create",
          success: true,
          data: {
            product: {
              id: "gid://shopify/Product/pod-created-888",
              title: "Washed Persian Medallion Rug",
              handle: "washed-persian-medallion-rug",
            },
          },
        } as unknown as ShopifyApiResponse;
      }
      return undefined;
    });

    const podItem: SeoReviewPushProductItem = {
      id: "pod-rug-101",
      productTitle: "Washed Persian Medallion Rug",
      productDescription: "<p>Vintage aesthetic boho rug</p>",
      seoTitle: "Washed Persian Medallion Rug | Boho Living Room Decor",
      seoDescription: "Shop the washed persian medallion rug with fast shipping.",
      handle: "washed-persian-medallion-rug",
      tags: ["pod", "pinterest-pod", "vintage boho rug"],
      vendor: "FFP Store",
      productType: "rug",
      images: [
        {
          previewUrl: "https://example.com/mockup_room_01.jpg",
          alt: "Washed Persian Medallion Rug styled in living room",
        },
        {
          previewUrl: "https://example.com/mockup_room_02.jpg",
          alt: "Washed Persian Medallion Rug styled in bedroom",
        },
      ],
      metafields: [
        {
          namespace: "custom",
          key: "print_file_url",
          value: "http://127.0.0.1:8768/api/pinterest-pod/assets/wf_001/design_101_cmyk_300dpi.jpg",
          type: "single_line_text_field",
        },
        {
          namespace: "custom",
          key: "print_specs",
          value: JSON.stringify({
            designId: "design_rug_101",
            productType: "rug",
            dpi: 300,
            widthPx: 4000,
            heightPx: 6400,
            colorMode: "CMYK",
          }),
          type: "json",
        },
      ],
    };

    const result = await pushSeoReviewProductToShopify(podItem, { moduleApiRunner: runner });

    assert.equal(result.success, true);
    assert.equal(result.productId, "gid://shopify/Product/pod-created-888");

    // 1. Verify media only contains the 2 AI mockups, no print master
    assert.ok(Array.isArray(capturedMedia));
    assert.equal(capturedMedia?.length, 2);
    assert.ok(!capturedMedia?.some((m) => JSON.stringify(m).includes("cmyk_300dpi")));

    // 2. Verify metafields are properly included for print master storage and uploaded to Shopify CDN (only print_file_url and print_specs)
    assert.ok(Array.isArray(capturedMetafields));
    assert.equal(capturedMetafields?.length, 2);
    const printFileMeta = capturedMetafields?.find((m: any) => m.key === "print_file_url") as any;
    assert.ok(printFileMeta);
    assert.ok(printFileMeta.value.includes("cdn.shopify.com"));
    assert.ok(printFileMeta.value.includes("design_101_cmyk_300dpi.jpg"));

    const printSpecsMeta = capturedMetafields?.find((m: any) => m.key === "print_specs") as any;
    assert.ok(printSpecsMeta);
    assert.ok(printSpecsMeta.value.includes("4000"));
    assert.ok(printSpecsMeta.value.includes("cdn.shopify.com"));

    const printFileRef = capturedMetafields?.find((m: any) => m.key === "print_file");
    assert.equal(printFileRef, undefined);
  });
});
