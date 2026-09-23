import assert from "node:assert/strict";
import test from "node:test";

import type {
  AutoSeoSourceProduct,
  SeoContentInput,
  SeoContentOutput,
} from "../../seo-content";
import { handoverAutoSeoToSeo } from "../auto-seo-to-seo-pipeline";

test("handoverAutoSeoToSeo: returns empty result when input products array is empty", async () => {
  const result = await handoverAutoSeoToSeo({
    products: [],
  });

  assert.equal(result.total, 0);
  assert.equal(result.successful, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.seoOutputs, []);
  assert.ok(result.workflowId.startsWith("auto-seo-handover-"));
});

test("handoverAutoSeoToSeo: processes products through SEO runner and produces structured results", async () => {
  const sampleProducts: readonly AutoSeoSourceProduct[] = [
    {
      id: "gid://shopify/Product/1001",
      title: "Handmade Ceramic Mug",
      handle: "handmade-ceramic-mug",
      descriptionHtml: "<p>A beautiful coffee mug</p>",
      productType: "Kitchen",
      tags: ["Ceramics", "Home"],
      images: [
        {
          id: "img-1",
          src: "https://example.com/mug.jpg",
          altText: "Ceramic Mug",
        },
      ],
    },
    {
      id: "gid://shopify/Product/1002",
      title: "Linen Kitchen Towel",
      handle: "linen-kitchen-towel",
      descriptionHtml: "<p>Organic linen towel</p>",
      productType: "Kitchen",
      tags: ["Linen"],
      images: [],
    },
  ];

  const fakeRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    return {
      productTitle: `SEO ${input.title}`,
      productDescription: `<p>SEO Optimized ${input.description}</p>`,
      productSeoTitle: `${input.title} | Premium Store`,
      productSeoDescription: `Discover high quality ${input.title} today.`,
      productHandle: input.handle || "seo-handle",
      images: (input.images || []).map((img, i) => ({
        sourceUrl: img.url,
        alt: img.alt || `Alt for ${input.title}`,
        webp: {
          url: `https://cdn.example.com/webp-${i}.webp`,
          filename: `webp-${i}.webp`,
        },
      })),
    };
  };

  const result = await handoverAutoSeoToSeo(
    {
      workflowId: "test-auto-seo-wf",
      products: sampleProducts,
    },
    {
      seoRunner: fakeRunner,
    },
  );

  assert.equal(result.workflowId, "test-auto-seo-wf");
  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.seoOutputs.length, 2);

  const firstItem = result.items[0];
  assert.equal(firstItem.productId, "gid://shopify/Product/1001");
  assert.equal(firstItem.success, true);
  assert.equal(firstItem.seoOutput?.productSeoTitle, "Handmade Ceramic Mug | Premium Store");
  assert.equal(firstItem.seoOutput?.images[0].webp?.url, "https://cdn.example.com/webp-0.webp");
});

test("handoverAutoSeoToSeo: handles individual failures without crashing batch", async () => {
  const sampleProducts: readonly AutoSeoSourceProduct[] = [
    {
      id: "gid://shopify/Product/2001",
      title: "Good Product",
      handle: "good-product",
    },
    {
      id: "gid://shopify/Product/2002",
      title: "Failing Product",
      handle: "failing-product",
    },
  ];

  const fakeRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    if (input.title === "Failing Product") {
      throw new Error("API rate limit exceeded");
    }
    return {
      productTitle: `SEO ${input.title}`,
      productDescription: "<p>Optimized</p>",
      productSeoTitle: `${input.title} - Best Buy`,
      productSeoDescription: "Meta description",
      productHandle: input.handle,
      images: [],
    };
  };

  const result = await handoverAutoSeoToSeo(
    {
      products: sampleProducts,
    },
    {
      seoRunner: fakeRunner,
    },
  );

  assert.equal(result.total, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.seoOutputs.length, 1);

  const failedItem = result.items.find((item) => item.productId === "gid://shopify/Product/2002");
  assert.ok(failedItem);
  assert.equal(failedItem.success, false);
  assert.match(failedItem.error || "", /rate limit/);
});
