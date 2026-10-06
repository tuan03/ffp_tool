import assert from "node:assert/strict";
import test from "node:test";

import type { CrawlProduct } from "../../customization-normalizer";
import type { SeoContentInput, SeoContentOutput } from "../../seo-content";
import { handoverCrawlerToSeo } from "../crawler-to-seo-pipeline";
import { TEST_SEO_STORE_PROFILE } from "./test-seo-store-profile";

const sampleProductA: CrawlProduct = {
  id: "prod-crawl-01",
  asin: "B001ALPHA",
  title: "Vintage Gothic Lamp",
  description: "A dark academia handcrafted desk lamp with brass finish.",
  bulletPoints: ["Solid brass", "Warm glow", "Handmade in USA"],
  categories: ["Home & Kitchen", "Lighting", "Desk Lamps"],
  media: [{ url: "https://example.com/lamp1.jpg", alt: "Gothic Lamp Front" }],
};

const sampleProductB: CrawlProduct = {
  id: "prod-crawl-02",
  asin: "B002BETA",
  title: "Personalized Leather Journal",
  description: "Handcrafted refillable leather journal with custom engraved name.",
  categories: ["Office Products", "Journals"],
  media: [{ url: "https://example.com/journal.jpg" }],
};

test("handoverCrawlerToSeo: returns empty result when input products array is empty", async () => {
  const result = await handoverCrawlerToSeo({
    jobId: "test-empty-job",
    products: [],
    storeProfile: TEST_SEO_STORE_PROFILE,
  });

  assert.equal(result.total, 0);
  assert.equal(result.successful, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.seoOutputs, []);
});

test("handoverCrawlerToSeo: runs customization normalization and SEO pipeline end-to-end", async () => {
  const mockSeoRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    return {
      productTitle: "SEO Optimized Product",
      productDescription: "<p>Grounded image description</p>",
      productSeoTitle: "Grounded Product | Premium Home",
      productSeoDescription: "Shop this image-grounded product.",
      productHandle: "grounded-product",
      images: input.images.map((img, i) => ({
        sourceUrl: img.url,
        alt: `Optimized image ${i + 1}`,
        webp: {
          filename: `optimized-img-${i + 1}.webp`,
          url: `https://cdn.example.com/optimized-img-${i + 1}.webp`,
        },
      })),
    };
  };

  const result = await handoverCrawlerToSeo(
    {
      jobId: "test-pipeline-job",
      products: [sampleProductA, sampleProductB],
      storeProfile: TEST_SEO_STORE_PROFILE,
    },
    {
      seoRunner: mockSeoRunner,
    },
  );

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.seoOutputs.length, 2);

  assert.equal(result.items[0].success, true);
  assert.equal(result.items[0].productId, "prod-crawl-01");
  assert.equal(result.items[0].seoOutput?.productTitle, "SEO Optimized Product");
  assert.deepEqual(Object.keys(result.items[0].seoInput).sort(), ["images", "niche", "storeProfile"]);
  assert.equal(result.items[0].seoOutput?.images[0].webp.filename, "optimized-img-1.webp");

  assert.equal(result.items[1].success, true);
  assert.equal(result.items[1].productId, "prod-crawl-02");
  assert.equal(result.items[1].seoOutput?.productTitle, "SEO Optimized Product");
});

test("handoverCrawlerToSeo: isolates individual failure without failing entire batch", async () => {
  const mockSeoRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    if (input.images[0]?.url.includes("lamp1")) {
      throw new Error("Simulated SEO Generation Error for Gothic Lamp");
    }
    return {
      productTitle: "SEO Grounded Product",
      productDescription: "<p>Grounded description</p>",
      productSeoTitle: "Grounded Product",
      productSeoDescription: "Description",
      productHandle: "handle",
      images: [],
    };
  };

  const result = await handoverCrawlerToSeo(
    {
      jobId: "test-partial-job",
      products: [sampleProductA, sampleProductB],
      storeProfile: TEST_SEO_STORE_PROFILE,
    },
    {
      seoRunner: mockSeoRunner,
    },
  );

  assert.equal(result.total, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);

  // Failed product
  const failedItem = result.items.find((it) => it.productId === "prod-crawl-01");
  assert.ok(failedItem);
  assert.equal(failedItem.success, false);
  assert.match(failedItem.error ?? "", /Simulated SEO Generation Error/);

  // Succeeded product
  const successfulItem = result.items.find((it) => it.productId === "prod-crawl-02");
  assert.ok(successfulItem);
  assert.equal(successfulItem.success, true);
  assert.equal(successfulItem.seoOutput?.productTitle, "SEO Grounded Product");
});
