import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fromAutoSeoBatch,
  fromAutoSeoProduct,
  runAutoSeoPipeline,
} from "../auto-seo-adapter";
import type { AutoSeoSourceProduct } from "../auto-seo-adapter";
import type { SeoContentInput, SeoContentOutput } from "../types";

describe("Auto SEO Adapter: fromAutoSeoProduct & runAutoSeoPipeline", () => {
  it("chuyển đổi chính xác ShopifyProductForAutoSeoUi sang SeoContentInput", () => {
    const shopifyProduct: AutoSeoSourceProduct = {
      id: "gid://shopify/Product/1001",
      title: "Vintage Handmade Ceramic Mug",
      handle: "vintage-handmade-ceramic-mug",
      descriptionHtml: "<p>Beautiful rustic ceramic mug, microwave safe.</p>",
      productType: "Kitchenware",
      tags: ["handmade", "pottery", "gift"],
      images: [
        {
          id: "img-1",
          url: "https://cdn.shopify.com/files/mug1.jpg",
          altText: "Ceramic Mug Front View",
        },
        {
          id: "img-2",
          url: "https://cdn.shopify.com/files/mug1.jpg", // Trùng URL
          altText: "Duplicate URL should be skipped",
        },
        {
          id: "img-3",
          url: "https://cdn.shopify.com/files/mug2.jpg",
          altText: "Ceramic Mug Handle Detail",
        },
      ],
      onlineStoreUrl: "https://store.myshopify.com/products/vintage-handmade-ceramic-mug",
    };

    const seoInput = fromAutoSeoProduct(shopifyProduct);

    assert.equal(seoInput.title, "Vintage Handmade Ceramic Mug");
    assert.equal(seoInput.handle, "vintage-handmade-ceramic-mug");
    assert.equal(seoInput.productId, "gid://shopify/Product/1001");
    assert.equal(seoInput.niche, "Kitchenware");
    assert.equal(seoInput.description, "<p>Beautiful rustic ceramic mug, microwave safe.</p>");
    assert.equal(seoInput.url, "https://store.myshopify.com/products/vintage-handmade-ceramic-mug");
    assert.equal(seoInput.images.length, 2);
    assert.deepEqual(seoInput.images[0], {
      id: "img-1",
      url: "https://cdn.shopify.com/files/mug1.jpg",
      alt: "Ceramic Mug Front View",
    });
    assert.deepEqual(seoInput.images[1], {
      id: "img-3",
      url: "https://cdn.shopify.com/files/mug2.jpg",
      alt: "Ceramic Mug Handle Detail",
    });
  });

  it("chuyển đổi SeoContentInputPayload từ AutoSeoOutput và lấy niche từ tags", () => {
    const payload: AutoSeoSourceProduct = {
      productId: "prod-888",
      handle: "personalized-leather-wallet",
      sourceTitle: "Personalized Leather Wallet for Men",
      sourceDescriptionHtml: "<ul><li>Genuine cowhide</li><li>RFID blocking</li></ul>",
      images: [
        {
          url: "https://cdn.shopify.com/files/wallet.png",
          altText: "Custom Engraved Wallet",
          position: 1,
        },
      ],
    };

    const seoInput = fromAutoSeoProduct(payload, "Leather Goods");

    assert.equal(seoInput.title, "Personalized Leather Wallet for Men");
    assert.equal(seoInput.handle, "personalized-leather-wallet");
    assert.equal(seoInput.productId, "prod-888");
    assert.equal(seoInput.description, "<ul><li>Genuine cowhide</li><li>RFID blocking</li></ul>");
    assert.equal(seoInput.niche, "Leather Goods");
    assert.equal(seoInput.images.length, 1);
    assert.equal(seoInput.images[0]?.url, "https://cdn.shopify.com/files/wallet.png");
    assert.equal(seoInput.images[0]?.alt, "Custom Engraved Wallet");
  });

  it("sử dụng featuredImage khi danh sách images rỗng và fallback niche an toàn", () => {
    const productWithoutImages: AutoSeoSourceProduct = {
      id: "gid://shopify/Product/555",
      title: "Cozy Wool Blanket",
      handle: "cozy-wool-blanket",
      description: "Thick winter wool blanket.",
      tags: ["Home Decor", "Bedding"],
      featuredImage: {
        url: "https://cdn.shopify.com/files/blanket-main.jpg",
        altText: "Cozy Blanket On Bed",
      },
    };

    const seoInput = fromAutoSeoProduct(productWithoutImages);

    assert.equal(seoInput.title, "Cozy Wool Blanket");
    assert.equal(seoInput.niche, "Home Decor");
    assert.equal(seoInput.images.length, 1);
    assert.equal(seoInput.images[0]?.url, "https://cdn.shopify.com/files/blanket-main.jpg");
    assert.equal(seoInput.images[0]?.alt, "Cozy Blanket On Bed");
  });

  it("fromAutoSeoBatch chuyển đổi đồng loạt một mảng sản phẩm", () => {
    const list: AutoSeoSourceProduct[] = [
      { id: "p1", title: "Item 1", handle: "item-1" },
      { id: "p2", title: "Item 2", handle: "item-2" },
    ];

    const batch = fromAutoSeoBatch(list, "Accessories");
    assert.equal(batch.length, 2);
    assert.equal(batch[0]?.title, "Item 1");
    assert.equal(batch[0]?.niche, "Accessories");
    assert.equal(batch[1]?.title, "Item 2");
  });

  it("runAutoSeoPipeline thực thi batch với runner giả lập thành công toàn bộ", async () => {
    const products: AutoSeoSourceProduct[] = [
      { id: "prod-1", title: "Canvas Tote Bag", handle: "canvas-tote-bag" },
      { id: "prod-2", title: "Enamel Camping Mug", handle: "enamel-camping-mug" },
    ];

    const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      return {
        productTitle: `SEO Optimized: ${input.title}`,
        productDescription: `<p>SEO content for ${input.title}</p>`,
        productSeoTitle: `${input.title} | Best Buy`,
        productSeoDescription: `Discover the ultimate ${input.title}.`,
        productHandle: input.handle,
        images: input.images.map((img) => ({
          sourceUrl: img.url,
          alt: `SEO ${input.title}`,
          webp: { filename: "optimized.webp" },
        })),
      };
    };

    const result = await runAutoSeoPipeline(products, {
      runner: mockRunner,
      concurrency: 2,
    });

    assert.equal(result.total, 2);
    assert.equal(result.successful, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.seoOutputs.length, 2);
    assert.equal(result.seoOutputs[0]?.productTitle, "SEO Optimized: Canvas Tote Bag");
    assert.equal(result.seoOutputs[1]?.productTitle, "SEO Optimized: Enamel Camping Mug");
    assert.equal(result.items[0]?.success, true);
    assert.equal(result.items[1]?.success, true);
  });

  it("runAutoSeoPipeline cô lập lỗi và không làm hỏng toàn bộ batch khi có 1 item thất bại", async () => {
    const products: AutoSeoSourceProduct[] = [
      { id: "prod-ok-1", title: "Good Product 1", handle: "good-1" },
      { id: "prod-fail", title: "Failing Product", handle: "fail-item" },
      { id: "prod-ok-2", title: "Good Product 2", handle: "good-2" },
    ];

    const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      if (input.productId === "prod-fail") {
        throw new Error("Simulated Vision OCR network timeout");
      }
      return {
        productTitle: `SEO ${input.title}`,
        productDescription: `<p>${input.title}</p>`,
        productSeoTitle: `SEO ${input.title}`,
        productSeoDescription: `Meta ${input.title}`,
        productHandle: input.handle,
        images: [],
      };
    };

    const result = await runAutoSeoPipeline(products, {
      runner: mockRunner,
      concurrency: 2,
    });

    assert.equal(result.total, 3);
    assert.equal(result.successful, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.seoOutputs.length, 2);

    const failedItem = result.items.find((it) => it.productId === "prod-fail");
    assert.ok(failedItem);
    assert.equal(failedItem.success, false);
    assert.equal(failedItem.error, "Simulated Vision OCR network timeout");

    const passedItems = result.items.filter((it) => it.success);
    assert.equal(passedItems.length, 2);
  });

  it("runAutoSeoPipeline phát realtime callbacks qua onItemCompleted, onItemFailed và onProgress", async () => {
    const products: AutoSeoSourceProduct[] = [
      { id: "prod-s-1", title: "Stream Bag 1", handle: "stream-1" },
      { id: "prod-s-fail", title: "Stream Fail", handle: "stream-fail" },
      { id: "prod-s-2", title: "Stream Bag 2", handle: "stream-2" },
    ];

    const completedIds: string[] = [];
    const failedIds: string[] = [];
    const progressList: number[] = [];

    const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      if (input.productId === "prod-s-fail") {
        throw new Error("Quota 429");
      }
      return {
        productTitle: `SEO ${input.title}`,
        productDescription: `<p>${input.title}</p>`,
        productSeoTitle: `SEO ${input.title}`,
        productSeoDescription: `Meta ${input.title}`,
        productHandle: input.handle,
        images: [],
      };
    };

    const result = await runAutoSeoPipeline(products, {
      runner: mockRunner,
      concurrency: 1,
      onItemCompleted: (itemResult) => {
        completedIds.push(itemResult.productId);
      },
      onItemFailed: (itemResult) => {
        failedIds.push(itemResult.productId);
      },
      onProgress: (stats) => {
        progressList.push(stats.percent);
      },
    });

    assert.equal(result.total, 3);
    assert.equal(result.successful, 2);
    assert.equal(result.failed, 1);
    assert.deepEqual(completedIds, ["prod-s-1", "prod-s-fail", "prod-s-2"]);
    assert.deepEqual(failedIds, ["prod-s-fail"]);
    assert.ok(progressList.length >= 3);
    assert.equal(progressList.at(-1), 100);
  });
});
