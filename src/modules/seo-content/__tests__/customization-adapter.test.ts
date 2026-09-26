import assert from "node:assert/strict";
import test from "node:test";

import type { CrawlProduct, CustomizationNormalizerOutput } from "../../customization-normalizer";
import {
  applySeoContentToCustomizationProduct,
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

test("SEO adapter excludes video input and only applies SEO-owned product fields", () => {
  const variants = [{ id: "variant-1", price: { amount: 29.95 } }];
  const customization = { hasCustomization: true, textInputs: [{ id: "name" }] };
  const product: CrawlProduct = {
    ...sampleProductA,
    sourceTitle: "Original Amazon title",
    variants,
    customization,
    media: [
      { url: " https://example.com/image.jpg ", kind: "image", alt: "Old alt", sourceAsin: "B09MUSIC01" },
      { url: "https://example.com/image.jpg", kind: "image", alt: "Old duplicate alt", sourceAsin: "B09MUSIC02" },
      { url: "https://example.com/video.mp4", kind: "video", alt: "Video alt", sourceAsin: "B09MUSIC01" },
      { url: "https://example.com/video-uppercase.mp4", kind: "VIDEO", alt: "Upper video alt", sourceAsin: "B09MUSIC02" },
    ],
  };
  const seoInput = fromCustomizationProduct(product);
  assert.deepEqual(seoInput.images.map((image) => image.url), ["https://example.com/image.jpg"]);

  const enriched = applySeoContentToCustomizationProduct(product, {
    productTitle: "SEO product title",
    productDescription: "<p>SEO description</p>",
    productSeoTitle: "SEO meta title",
    productSeoDescription: "SEO meta description",
    productHandle: "seo-product-handle",
    images: [{
      sourceUrl: "https://example.com/image.jpg",
      alt: "SEO image alt 1",
      webp: { filename: "ignored.webp", data: Buffer.from("not-public") },
    }],
  });

  assert.equal(enriched.title, "SEO product title");
  assert.equal(enriched.descriptionHtml, "<p>SEO description</p>");
  assert.equal(enriched.handle, "seo-product-handle");
  assert.deepEqual(enriched.seo, { title: "SEO meta title", description: "SEO meta description" });
  assert.equal(enriched.sourceTitle, "Original Amazon title");
  assert.deepEqual(enriched.variants, variants);
  assert.deepEqual(enriched.customization, customization);
  assert.equal(enriched.media?.[0].alt, "SEO image alt 1");
  assert.equal(enriched.media?.[0].url, " https://example.com/image.jpg ");
  assert.equal(enriched.media?.[0].sourceAsin, "B09MUSIC01");
  assert.equal(enriched.media?.[1].alt, "SEO image alt 1");
  assert.equal(enriched.media?.[1].sourceAsin, "B09MUSIC02");
  assert.equal(enriched.media?.[2].alt, "Video alt");
  assert.equal(enriched.media?.[3].alt, "Upper video alt");
  assert.equal("webp" in (enriched.media?.[0] ?? {}), false);
  assert.equal(JSON.stringify(enriched).includes("not-public"), false);
});

test("SEO adapter derives deterministic unique handles for split products", () => {
  const seoOutput: SeoContentOutput = {
    productTitle: "SEO product title",
    productDescription: "<p>SEO description</p>",
    productSeoTitle: "SEO title",
    productSeoDescription: "SEO description",
    productHandle: "gifts-that-are-black",
    images: [],
  };
  const firstProduct: CrawlProduct = {
    ...sampleProductB,
    sourceKey: "amazon:B0PARENT:color:black women 03",
  };
  const secondProduct: CrawlProduct = {
    ...sampleProductB,
    id: "prod-3",
    sourceKey: "amazon:B0PARENT:color:st02",
  };

  const first = applySeoContentToCustomizationProduct(firstProduct, seoOutput, {
    ensureUniqueHandle: true,
  });
  const repeated = applySeoContentToCustomizationProduct(firstProduct, seoOutput, {
    ensureUniqueHandle: true,
  });
  const second = applySeoContentToCustomizationProduct(secondProduct, seoOutput, {
    ensureUniqueHandle: true,
  });

  assert.equal(first.handle, repeated.handle);
  assert.notEqual(first.handle, second.handle);
  assert.match(String(first.handle ?? ""), /^gifts-that-are-black-black-women-03-[a-f0-9]{8}$/);
  assert.match(String(second.handle ?? ""), /^gifts-that-are-black-st02-[a-f0-9]{8}$/);
});

test("SEO adapter preserves an existing Shopify handle", () => {
  const enriched = applySeoContentToCustomizationProduct(
    { ...sampleProductB, sourceKey: "amazon:B0PARENT:color:st02" },
    {
      productTitle: "SEO title",
      productDescription: "<p>SEO description</p>",
      productSeoTitle: "SEO title",
      productSeoDescription: "SEO description",
      productHandle: "new-generated-handle",
      images: [],
    },
    {
      ensureUniqueHandle: true,
      existingShopifyHandle: "existing-shopify-handle",
    },
  );

  assert.equal(enriched.handle, "existing-shopify-handle");
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

test("fromCustomizationProduct: enriches title, description and variantLabel from splitContext and variants", () => {
  const productWithSplitContext: CrawlProduct = {
    ...sampleProductA,
    title: "Personalized Christian Handbag Set",
    splitContext: { attribute: "Color", value: "Pink Faith" },
  };

  const seoInput = fromCustomizationProduct(productWithSplitContext);
  assert.equal(seoInput.title, "Personalized Christian Handbag Set - Pink Faith");
  assert.match(seoInput.description, /• Color: Pink Faith/);
  assert.equal(seoInput.variantLabel, "Pink Faith");

  // If variants[0].options is present instead of splitContext.value
  const productWithVariants: CrawlProduct = {
    ...sampleProductA,
    title: "Personalized Christian Handbag Set",
    splitContext: { attribute: "Color", value: null },
    variants: [{ options: { Color: "Purple Faith" } }],
  };

  const seoInputVar = fromCustomizationProduct(productWithVariants);
  assert.equal(seoInputVar.title, "Personalized Christian Handbag Set - Purple Faith");
  assert.match(seoInputVar.description, /• Color: Purple Faith/);
  assert.equal(seoInputVar.variantLabel, "Purple Faith");

  // Does not duplicate variant label if already in title
  const productAlreadyHavingVariant: CrawlProduct = {
    ...sampleProductA,
    title: "Personalized Christian Handbag Set - Pink Faith",
    splitContext: { attribute: "Color", value: "Pink Faith" },
  };
  const seoInputDup = fromCustomizationProduct(productAlreadyHavingVariant);
  assert.equal(seoInputDup.title, "Personalized Christian Handbag Set - Pink Faith");
});

test("applySeoContentToCustomizationProduct: preserves variant label in product title and SEO title", () => {
  const splitProduct: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    splitContext: { attribute: "Color", value: "Pink Faith" },
  };

  const seoOutput: SeoContentOutput = {
    productTitle: "Personalized Christian Faux Leather Handbag Set - Tote & Wallet",
    productDescription: "<p>Beautiful Christian handbag set.</p>",
    productSeoTitle: "Personalized Christian Handbag Set | Premium Tote & Wallet",
    productSeoDescription: "Shop Christian faux leather handbag set.",
    productHandle: "christian-handbag-set",
    images: [],
  };

  const enriched = applySeoContentToCustomizationProduct(splitProduct, seoOutput, {
    ensureUniqueHandle: true,
  });

  assert.match(enriched.title ?? "", /Pink Faith/);
  assert.match(enriched.seo?.title ?? "", /Pink Faith/);
  assert.ok((enriched.seo?.title?.length ?? 0) <= 70);
  assert.match(String(enriched.handle ?? ""), /pink-faith/);

  // Does not duplicate variant label if already present in seoOutput.productTitle
  const seoOutputWithVariant: SeoContentOutput = {
    ...seoOutput,
    productTitle: "Personalized Christian Handbag Set - Pink Faith",
    productSeoTitle: "Personalized Christian Handbag Set - Pink Faith",
  };
  const enrichedDup = applySeoContentToCustomizationProduct(splitProduct, seoOutputWithVariant);
  assert.equal(enrichedDup.title, "Personalized Christian Handbag Set - Pink Faith");
  assert.equal(enrichedDup.seo?.title, "Personalized Christian Handbag Set - Pink Faith");
});

test("applySeoContentToCustomizationProduct: two variants of same parent ASIN produce distinct titles, handles, descriptions, and SEO descriptions", () => {
  const seoOutput: SeoContentOutput = {
    productTitle: "Personalized Christian Handbag Set",
    productDescription: "<p>Elevate your style with this Christian handbag set.</p><ul><li>Features expressive artwork.</li></ul>",
    productSeoTitle: "Christian Handbag Set",
    productSeoDescription: "Shop Christian faux leather handbag set. Distinctive design and everyday functionality.",
    productHandle: "christian-handbag-set",
    images: [],
  };

  const variant1: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    splitContext: { attribute: "Color", value: "Pink Faith" },
  };
  const variant2: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    splitContext: { attribute: "Color", value: "Be Still and Know" },
  };

  const enriched1 = applySeoContentToCustomizationProduct(variant1, seoOutput, { ensureUniqueHandle: true });
  const enriched2 = applySeoContentToCustomizationProduct(variant2, seoOutput, { ensureUniqueHandle: true });

  assert.notEqual(enriched1.title, enriched2.title);
  assert.notEqual(enriched1.seo?.title, enriched2.seo?.title);
  assert.notEqual(enriched1.handle, enriched2.handle);
  assert.match(enriched1.title ?? "", /Pink Faith/);
  assert.match(enriched2.title ?? "", /Be Still and Know/);

  // Variant preservation in descriptionHtml and seo.description
  assert.notEqual(enriched1.descriptionHtml, enriched2.descriptionHtml);
  assert.match(enriched1.descriptionHtml ?? "", /Pink Faith/);
  assert.match(enriched2.descriptionHtml ?? "", /Be Still and Know/);

  assert.notEqual(enriched1.seo?.description, enriched2.seo?.description);
  assert.match(enriched1.seo?.description ?? "", /Pink Faith/);
  assert.match(enriched2.seo?.description ?? "", /Be Still and Know/);
  assert.ok((enriched1.seo?.description?.length ?? 0) <= 160);
  assert.ok((enriched2.seo?.description?.length ?? 0) <= 160);
});

test("applySeoContentToCustomizationProduct: clamps title to 100 characters even if variant label is already present", () => {
  const splitProduct: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    splitContext: { attribute: "Color", value: "Be Still and Know" },
  };

  // Base title already has variant label, but total length is 104 (> 100)
  const longSeoOutput: SeoContentOutput = {
    productTitle: "Personalized Christian Faux Leather Handbag Set - Scripture Tote & Wallet for Women - Be Still and Know",
    productDescription: "<p>Description</p>",
    productSeoTitle: "Christian Handbag Set - Be Still and Know",
    productSeoDescription: "Description",
    productHandle: "handbag-set",
    images: [],
  };

  const enriched = applySeoContentToCustomizationProduct(splitProduct, longSeoOutput);
  assert.ok((enriched.title?.length ?? 0) <= 100, `Expected title length <= 100, got ${enriched.title?.length}: "${enriched.title}"`);
  assert.match(enriched.title ?? "", /Be Still and Know/);
});

test("applySeoContentToCustomizationProduct: does not truncate variant label in SEO title when exceeding 70 characters", () => {
  const splitProduct: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    splitContext: { attribute: "Color", value: "Be Still and Know" },
  };

  // 71 characters, ends with " - Be Still and Know"
  const longSeoTitleOutput: SeoContentOutput = {
    productTitle: "Personalized Christian Handbag Set",
    productDescription: "<p>Description</p>",
    productSeoTitle: "Personalized Christian Handbag Set - Scripture Tote - Be Still and Know",
    productSeoDescription: "Description",
    productHandle: "handbag-set",
    images: [],
  };

  const enriched = applySeoContentToCustomizationProduct(splitProduct, longSeoTitleOutput);
  assert.ok((enriched.seo?.title?.length ?? 0) <= 70, `Expected SEO title length <= 70, got ${enriched.seo?.title?.length}`);
  // MUST NOT end with mutilated "Be Still and Kno"
  assert.doesNotMatch(enriched.seo?.title ?? "", /Be Still and Kno$/);
  assert.match(enriched.seo?.title ?? "", /Be Still and Know/);
});

test("runCustomizationSeoPipeline: enriches variant products with distinct titles, handles, descriptions, and SEO descriptions even if runner returns static base output", async () => {
  const variant1: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    title: "Christian Handbag Set",
    splitContext: { attribute: "Color", value: "Pink Faith" },
  };
  const variant2: CrawlProduct = {
    ...sampleProductA,
    parentAsin: "B0G1SSY9S7",
    title: "Christian Handbag Set",
    splitContext: { attribute: "Color", value: "Be Still and Know" },
  };

  // Static runner that completely ignores variant input
  const staticRunner = async (): Promise<SeoContentOutput> => ({
    productTitle: "Christian Handbag Set",
    productDescription: "<p>General description</p>",
    productSeoTitle: "Christian Handbag Set - Women Handbag",
    productSeoDescription: "Discover this premium Christian Handbag Set for daily use. Shop now!",
    productHandle: "christian-handbag-set",
    images: [],
  });

  const result = await runCustomizationSeoPipeline([variant1, variant2], { runner: staticRunner });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.seoOutputs.length, 2);

  const out1 = result.seoOutputs[0];
  const out2 = result.seoOutputs[1];

  // Distinct Titles
  assert.notEqual(out1.productTitle, out2.productTitle);
  assert.match(out1.productTitle, /Pink Faith/);
  assert.match(out2.productTitle, /Be Still and Know/);

  // Distinct SEO Titles
  assert.notEqual(out1.productSeoTitle, out2.productSeoTitle);
  assert.match(out1.productSeoTitle, /Pink Faith/);
  assert.match(out2.productSeoTitle, /Be Still and Know/);

  // Distinct Handles
  assert.notEqual(out1.productHandle, out2.productHandle);

  // Distinct Descriptions
  assert.notEqual(out1.productDescription, out2.productDescription);
  assert.match(out1.productDescription, /Pink Faith/);
  assert.match(out2.productDescription, /Be Still and Know/);

  // Distinct SEO Descriptions
  assert.notEqual(out1.productSeoDescription, out2.productSeoDescription);
  assert.match(out1.productSeoDescription, /Pink Faith/);
  assert.match(out2.productSeoDescription, /Be Still and Know/);
});

test("fromCustomizationProduct: always places variant representative image into images[0]", () => {
  const productWithVariantMedia: CrawlProduct = {
    id: "prod-var-img",
    title: "Viking Bedding Set",
    media: [
      { url: "https://example.com/gallery-1.jpg", alt: "General Gallery 1" },
      { url: "https://example.com/variant-valhalla.jpg", alt: "Valhalla Design Variant" },
      { url: "https://example.com/gallery-2.jpg", alt: "General Gallery 2" },
    ],
    variants: [
      { id: "var-1", imageUrl: "https://example.com/variant-valhalla.jpg" },
    ],
  };

  const seoInput = fromCustomizationProduct(productWithVariantMedia);
  assert.equal(seoInput.images.length, 3);
  assert.equal(seoInput.images[0].url, "https://example.com/variant-valhalla.jpg");
  assert.equal(seoInput.images[0].alt, "Valhalla Design Variant");
  assert.equal(seoInput.images[1].url, "https://example.com/gallery-1.jpg");
  assert.equal(seoInput.images[2].url, "https://example.com/gallery-2.jpg");
});

test("fromCustomizationProduct: selects matching variant image among multiple variants and preserves storeId", () => {
  const product: CrawlProduct = {
    id: "prod-multi-var",
    title: "Viking Quilt",
    storeId: "jeminise",
    media: [
      { id: "img-black", url: "https://example.com/black.jpg", alt: "Black" },
      { id: "img-valhalla", url: "https://example.com/valhalla.jpg", alt: "Valhalla" },
    ],
    variants: [
      { id: "var-black", title: "Black", imageId: "img-black" },
      { id: "var-valhalla", title: "Valhalla", imageId: "img-valhalla" },
    ],
    splitContext: {
      attribute: "Design",
      value: "Valhalla",
      sourceAsins: ["B0VALHALLA"],
    },
  };

  const seoInput = fromCustomizationProduct(product);
  assert.equal(seoInput.storeId, "jeminise");
  assert.equal(seoInput.images[0].url, "https://example.com/valhalla.jpg");
  assert.equal(seoInput.images[0].alt, "Valhalla");
});

test("runCustomizationSeoPipeline: streams realtime callbacks (onItemCompleted, onProgress)", async () => {
  const streamedItems: string[] = [];
  const progressList: number[] = [];

  const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => ({
    productTitle: `SEO - ${input.title}`,
    productDescription: `<p>${input.description}</p>`,
    productSeoTitle: `SEO | ${input.title}`.slice(0, 70),
    productSeoDescription: `Description for ${input.title}`.slice(0, 160),
    productHandle: input.handle || "custom-handle",
    images: input.images.map((img, idx) => ({
      sourceUrl: img.url,
      webp: { filename: `seo-img-${idx + 1}.webp` },
      alt: img.alt || `SEO Alt ${idx + 1}`,
    })),
  });

  const result = await runCustomizationSeoPipeline([sampleProductA, sampleProductB], {
    runner: mockRunner,
    concurrency: 1,
    onItemCompleted: (itemResult) => {
      streamedItems.push(itemResult.productId || "");
      assert.ok(itemResult.success);
      assert.ok(itemResult.seoOutput);
    },
    onProgress: (stats) => {
      progressList.push(stats.percent);
    },
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.deepEqual(streamedItems, ["prod-1", "prod-2"]);
  assert.ok(progressList.length >= 2);
  assert.equal(progressList.at(-1), 100);
});

test("runCustomizationSeoPipeline: preserves exact order even when input contains identical product object references", async () => {
  let counter = 0;
  const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    counter += 1;
    const callIdx = counter;
    // Delay first item longer to ensure out-of-order completion under concurrency
    const delay = callIdx === 1 ? 40 : 10;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      productTitle: `SEO - ${input.title} - Call ${callIdx}`,
      productDescription: `<p>${input.description}</p>`,
      productSeoTitle: `SEO | ${input.title}`.slice(0, 70),
      productSeoDescription: `Description for ${input.title}`.slice(0, 160),
      productHandle: `handle-${callIdx}`,
      images: [],
    };
  };

  // Pass identical reference sampleProductA twice
  const result = await runCustomizationSeoPipeline([sampleProductA, sampleProductA], {
    runner: mockRunner,
    concurrency: 2,
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.seoOutputs.length, 2);
  // Item 0 corresponds to first enqueue (Call 1), item 1 to second enqueue (Call 2)
  assert.match(result.seoOutputs[0].productTitle, /Call 1/);
  assert.match(result.seoOutputs[1].productTitle, /Call 2/);
});
