import assert from "node:assert/strict";
import test from "node:test";

import type { CrawlProduct, CustomizationNormalizerOutput } from "../../customization-normalizer";
import {
  fromCustomizationBatch,
  fromCustomizationProduct,
  runCustomizationSeoPipeline,
} from "../customization-adapter";
import type { SeoContentInput, SeoContentOutput } from "../types";

const sampleProductA: CrawlProduct = {
  id: "prod-1",
  asin: "B09MUSIC01",
  title: "Personalized Music Player Rug",
  description: "A soft velvet rug featuring your favorite music track.",
  bulletPoints: ["Durable non-slip backing", "High definition digital print", "Machine washable"],
  categories: ["Home & Kitchen", "Home Décor Products", "Rugs", "Area Rugs"],
  media: [
    { url: "https://example.com/img1.jpg", alt: "Music Rug Front View" },
    { url: "https://example.com/img2.jpg", alt: "Music Rug Close Up" },
    { url: "https://example.com/img1.jpg", alt: "Duplicate URL should be pruned" },
  ],
  handle: "personalized-music-player-rug",
};

const sampleProductB: CrawlProduct = {
  id: "prod-2",
  parentAsin: "B09MIN02",
  sourceTitle: "Minimalist Wooden Clock",
  categories: [],
  media: [{ url: "https://example.com/clock.png" }],
};

test("fromCustomizationProduct: correctly maps complete CrawlProduct to SeoContentInput", () => {
  const seoInput = fromCustomizationProduct(sampleProductA);

  assert.equal(seoInput.title, "Personalized Music Player Rug");
  assert.match(seoInput.description, /A soft velvet rug/);
  assert.match(seoInput.description, /• Durable non-slip backing/);
  assert.match(seoInput.description, /• Machine washable/);
  assert.equal(seoInput.niche, "Area Rugs");
  assert.equal(seoInput.handle, "personalized-music-player-rug");
  assert.equal(seoInput.images.length, 2);
  assert.equal(seoInput.images[0].url, "https://example.com/img1.jpg");
  assert.equal(seoInput.images[0].alt, "Music Rug Front View");
  assert.equal(seoInput.images[1].url, "https://example.com/img2.jpg");
});

test("fromCustomizationProduct: handles sparse product, falls back to default niche and sourceTitle", () => {
  const seoInput = fromCustomizationProduct(sampleProductB, "wall decor");

  assert.equal(seoInput.title, "Minimalist Wooden Clock");
  assert.equal(seoInput.niche, "wall decor");
  assert.equal(seoInput.description, "Minimalist Wooden Clock");
  assert.equal(seoInput.images.length, 1);
  assert.equal(seoInput.images[0].url, "https://example.com/clock.png");
  assert.equal(seoInput.handle, "");
});

test("fromCustomizationBatch: converts array and CustomizationNormalizerOutput", () => {
  const batchOutput: CustomizationNormalizerOutput = {
    jobId: "job-123",
    status: "completed",
    products: [sampleProductA, sampleProductB],
    normalizationSummary: {
      totalProducts: 2,
      customizedProducts: 0,
      untouchedProducts: 2,
      normalizedAssetsCount: 0,
    },
  };

  const inputsFromOutput = fromCustomizationBatch(batchOutput);
  assert.equal(inputsFromOutput.length, 2);
  assert.equal(inputsFromOutput[0].title, "Personalized Music Player Rug");
  assert.equal(inputsFromOutput[1].title, "Minimalist Wooden Clock");

  const inputsFromArray = fromCustomizationBatch([sampleProductA]);
  assert.equal(inputsFromArray.length, 1);
  assert.equal(inputsFromArray[0].title, "Personalized Music Player Rug");
});

test("runCustomizationSeoPipeline: successfully runs batch through runner and produces JSON output list", async () => {
  const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => ({
    productTitle: `SEO - ${input.title}`,
    productDescription: `<p>${input.description}</p>`,
    productSeoTitle: `SEO | ${input.title}`.slice(0, 70),
    productSeoDescription: `Description for ${input.title}`.slice(0, 160),
    productHandle: input.handle || "custom-handle",
    images: input.images.map((img, idx) => ({
      sourceUrl: img.url,
      webp: { filename: `seo-img-${idx + 1}.webp`, mimeType: "image/webp" },
      alt: img.alt || `SEO Alt ${idx + 1}`,
    })),
  });

  const result = await runCustomizationSeoPipeline([sampleProductA, sampleProductB], {
    runner: mockRunner,
    concurrency: 2,
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.seoOutputs.length, 2);

  // Check product 1 output
  assert.equal(result.seoOutputs[0].productTitle, "SEO - Personalized Music Player Rug");
  assert.equal(result.seoOutputs[0].productHandle, "personalized-music-player-rug");
  assert.equal(result.seoOutputs[0].images.length, 2);

  // Check product 2 output
  assert.equal(result.seoOutputs[1].productTitle, "SEO - Minimalist Wooden Clock");
  assert.equal(result.seoOutputs[1].productHandle, "custom-handle");

  // Check enriched items
  assert.equal(result.items[0].asin, "B09MUSIC01");
  assert.equal(result.items[0].sourceProduct, sampleProductA);
  assert.equal(result.items[0].success, true);
});

test("runCustomizationSeoPipeline: handles individual failures gracefully without crashing the whole batch", async () => {
  const flakyRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    if (input.title.includes("Clock")) {
      throw new Error("External SEO provider quota exceeded");
    }
    return {
      productTitle: `SEO - ${input.title}`,
      productDescription: `<p>${input.description}</p>`,
      productSeoTitle: input.title,
      productSeoDescription: input.description,
      productHandle: "handled",
      images: [],
    };
  };

  const result = await runCustomizationSeoPipeline([sampleProductA, sampleProductB], {
    runner: flakyRunner,
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.seoOutputs.length, 1);

  assert.equal(result.items[0].success, true);
  assert.ok(result.items[0].seoOutput);

  assert.equal(result.items[1].success, false);
  assert.equal(result.items[1].error, "External SEO provider quota exceeded");
  assert.equal(result.items[1].seoOutput, undefined);
});
