import assert from "node:assert/strict";
import test from "node:test";

import { runSeoContentDetailed } from "../service";
import { JEMINISE_BEDDING_PROFILE } from "../internal/store-profiles";
import {
  HeuristicContentGenerator,
  buildBeddingSeoDescription,
} from "../internal/content-generation/heuristic-content-generator";
import { GeminiSeoContentGenerator } from "../internal/content-generation/gemini-content-generator";
import { formatProductDescriptionHtml } from "../internal/content-generation/html-description-formatter";
import type { ContentFactSheet } from "../internal/content-generation/content-generation-types";

test("buildBeddingSeoDescription produces descriptions containing all 3 keywords within 160 chars", () => {
  const titles = [
    "Viking Quilt",
    "Viking Quilt Bedding Set",
    "Norse Mythology Odin Ravens Tree of Life Quilt Bedding Set",
    "Ultra Long Product Title With Many Descriptive Words And Viking Mythology Symbols",
  ];

  for (const title of titles) {
    const desc = buildBeddingSeoDescription(title, "Odin & Ravens", 160);
    assert.ok(desc.length <= 160, `Description length ${desc.length} exceeds 160 for title: ${title}`);
    assert.ok(desc.length >= 120, `Description length ${desc.length} too short for title: ${title}`);
    assert.ok(desc.includes("Comforter"), "Missing Comforter keyword");
    assert.ok(desc.includes("Quilt"), "Missing Quilt keyword");
    assert.ok(desc.includes("Duvet Cover"), "Missing Duvet Cover keyword");
  }
});

test("HeuristicContentGenerator creates rich Bedding content for Jeminise profile", async () => {
  const generator = new HeuristicContentGenerator();
  const facts: ContentFactSheet = {
    originalTitle: "Viking Quilt Bedding Set",
    originalDescription: "Detailed Norse artwork on bedding.",
    niche: "Bedding & Home Decor",
    physicalProductIdentity: "bedding set",
    typographyVisibleTexts: ["VALHALLA"],
    typographyStyleSummary: "bold runic lettering",
    visualEntities: "Viking warrior with axe and raven shield",
    targetAudience: ["Viking history and mythology enthusiasts"],
    occasions: ["housewarming"],
    useCases: ["master bedroom decor"],
    personalizationSupported: false,
    variantLabel: "King Size",
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };

  const draft = await generator.generate({
    facts,
    keywords: {
      primary: "Viking Quilt",
      secondary: ["Norse Bedding"],
      supportingKeywords: [],
      framingConcepts: [],
      targetedKeywords: [],
    },
    constraints: {
      maxSeoTitleLength: 70,
      maxSeoDescriptionLength: 160,
      maxHandleLength: 80,
      maxBullets: 5,
      preserveExistingHandle: true,
    },
  });

  // 1. Title and SEO title must NOT force "Comforter, Quilt, Duvet Cover"
  assert.equal(draft.productTitle.includes("Comforter, Quilt, Duvet Cover"), false);
  assert.equal(draft.productSeoTitle.includes("Comforter, Quilt, Duvet Cover"), false);
  assert.match(draft.productTitle, /Viking.*Quilt/i);

  // 2. SEO Description contains all 3 styles and length <= 160
  assert.ok(draft.productSeoDescription.includes("Comforter"));
  assert.ok(draft.productSeoDescription.includes("Quilt"));
  assert.ok(draft.productSeoDescription.includes("Duvet Cover"));
  assert.ok(draft.productSeoDescription.length <= 160);
  assert.ok(draft.productSeoDescription.length >= 145);

  // 3. Style Options present on draft
  assert.ok(draft.styleOptions);
  assert.equal(draft.styleOptions.length, 3);
  const styleNames = draft.styleOptions.map((o) => o.name);
  assert.deepEqual(styleNames, ["Comforter", "Quilt", "Duvet Cover"]);

  // 4. Formatted HTML contains dedicated Available Styles section, microfiber, and machine wash
  const html = formatProductDescriptionHtml(draft);
  assert.match(html, /Available Styles/i);
  assert.match(html, /<strong>Comforter:<\/strong>/i);
  assert.match(html, /<strong>Quilt:<\/strong>/i);
  assert.match(html, /<strong>Duvet Cover:<\/strong>/i);
  assert.match(html, /microfiber/i);
  assert.match(html, /machine wash/i);

  // 5. AEO Suite
  assert.ok(draft.aeo_quick_summary);
  assert.match(draft.aeo_quick_summary, /Comforter/);
  assert.match(draft.aeo_quick_summary, /Quilt/);
  assert.match(draft.aeo_quick_summary, /Duvet Cover/);
  assert.match(draft.aeo_quick_summary, /microfiber/i);

  assert.ok(draft.aeo_faq);
  assert.equal(draft.aeo_faq.length, 4);
  const diffFaq = draft.aeo_faq.find((f) => /difference between/i.test(f.question));
  assert.ok(diffFaq, "FAQ should contain difference question between 3 options");
  assert.match(diffFaq.answer, /Comforter/);
  assert.match(diffFaq.answer, /Quilt/);
  assert.match(diffFaq.answer, /Duvet Cover/);
});

test("GeminiSeoContentGenerator injects STORE_PRODUCT_OFFERING and handles styleOptions fallback", async () => {
  let capturedPrompt = "";
  let capturedSystemInstruction = "";

  const mockSdk = {
    async generateStructuredText(options: {
      prompt: string;
      systemInstruction: string;
      responseJsonSchema: unknown;
    }) {
      capturedPrompt = options.prompt;
      capturedSystemInstruction = options.systemInstruction;
      return {
        rawText: JSON.stringify({
          productTitle: "Viking Warrior Quilt Bedding Set",
          intro: "Immerse your bedroom in legendary Norse heritage with this stunning bedding set.",
          bullets: [
            { label: "Design", text: "Striking Viking warrior and raven artwork." },
            { label: "Materials", text: "Premium ultra-soft microfiber construction." },
          ],
          guidance: ["Machine wash cold on gentle cycle."],
          closing: "A timeless centerpiece for any Nordic mythology enthusiast.",
          productSeoTitle: "Viking Warrior Quilt Bedding Set | Shop Online",
          productSeoDescription:
            "Discover this Viking Quilt. Available in Comforter, Quilt, or Duvet Cover styles. Premium microfiber fabric with vivid colors. Shop online now!",
          aeo_quick_summary:
            "The Viking Warrior Quilt is available in Comforter, Quilt, or Duvet Cover styles, made from premium microfiber for year-round warmth.",
          aeo_faq: [
            {
              question: "What is the difference between Comforter, Quilt, and Duvet Cover options?",
              answer: "The Comforter is thick and plush, the Quilt is lightweight stitched, and the Duvet Cover is a zippered casing.",
            },
            { question: "Is it machine washable?", answer: "Yes, machine wash cold on gentle cycle." },
            { question: "What materials are used?", answer: "Premium ultra-soft brushed microfiber." },
            { question: "What makes it unique?", answer: "Original Viking warrior artwork with vivid sublimation print." },
          ],
        }),
      };
    },
    async generateProductImageAnalysis() {
      throw new Error("Not implemented in test");
    },
  };

  const geminiGenerator = new GeminiSeoContentGenerator(mockSdk);
  const facts: ContentFactSheet = {
    originalTitle: "Viking Quilt Bedding Set",
    originalDescription: "Detailed Norse artwork on bedding.",
    niche: "Bedding & Home Decor",
    physicalProductIdentity: "bedding set",
    typographyVisibleTexts: [],
    targetAudience: ["Viking enthusiasts"],
    occasions: [],
    useCases: [],
    personalizationSupported: false,
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };

  const draft = await geminiGenerator.generate({
    facts,
    keywords: {
      primary: "Viking Quilt",
      secondary: [],
      supportingKeywords: [],
      framingConcepts: [],
      targetedKeywords: [],
    },
    constraints: {
      maxSeoTitleLength: 70,
      maxSeoDescriptionLength: 160,
      maxHandleLength: 80,
      maxBullets: 5,
      preserveExistingHandle: true,
    },
  });

  // Verify prompt injection
  assert.match(capturedPrompt, /<STORE_PRODUCT_OFFERING>/);
  assert.match(capturedPrompt, /Store: Jeminise \(Bedding & Home Decor\)/);
  assert.match(capturedPrompt, /Comforter: Plush all-season warmth/);
  assert.match(capturedPrompt, /Quilt: Lightweight classic diamond stitching/);
  assert.match(capturedPrompt, /Duvet Cover: Zippered protective casing/);
  assert.match(capturedPrompt, /Fabric: Premium ultra-soft brushed microfiber/);

  // Verify system instruction
  assert.match(capturedSystemInstruction, /STORE-SPECIFIC OFFERINGS/);
  assert.match(capturedSystemInstruction, /DO NOT force "Comforter, Quilt, Duvet Cover" into product title/);

  // Verify styleOptions fallback populated from bedding profile
  assert.ok(draft.styleOptions);
  assert.equal(draft.styleOptions.length, 3);
  assert.equal(draft.styleOptions[0].name, "Comforter");
  assert.equal(draft.styleOptions[1].name, "Quilt");
  assert.equal(draft.styleOptions[2].name, "Duvet Cover");
});

test("Full SEO pipeline run with siteDomain: 'jeminise.com' satisfies all Bedding SEO requirements", async () => {
  const result = await runSeoContentDetailed({
    siteDomain: "jeminise.com",
    title: "Viking Quilt Bedding Set",
    description: "Authentic Norse design quilt bedding set.",
    handle: "viking-quilt-bedding-set",
    niche: "Bedding Sets",
    images: [{ url: "https://jeminise.com/cdn/viking-quilt.jpg" }],
    variantLabel: "Queen Size",
  }, { imageMode: "alt_only" });

  const output = result.output;

  // 1. Natural title without forced option list
  assert.ok(output.productTitle.length > 0);
  assert.equal(output.productTitle.includes("Comforter, Quilt, Duvet Cover"), false);
  assert.ok(output.productSeoTitle.length <= 70);
  assert.equal(output.productSeoTitle.includes("Comforter, Quilt, Duvet Cover"), false);

  // 2. Product Description HTML has dedicated Available Styles section with all 3 options, microfiber, machine wash
  assert.match(output.productDescription, /Available Styles/i);
  assert.match(output.productDescription, /<strong>Comforter:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Quilt:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Duvet Cover:<\/strong>/i);
  assert.match(output.productDescription, /microfiber/i);
  assert.match(output.productDescription, /machine wash/i);

  // 3. SEO Description has all 3 keywords and <= 160 characters
  assert.ok(output.productSeoDescription.includes("Comforter"));
  assert.ok(output.productSeoDescription.includes("Quilt"));
  assert.ok(output.productSeoDescription.includes("Duvet Cover"));
  assert.ok(output.productSeoDescription.length <= 160);
  assert.ok(output.productSeoDescription.length >= 145);

  // 4. AEO Quick Summary
  assert.ok(output.aeo_quick_summary);
  assert.match(output.aeo_quick_summary, /Comforter/);
  assert.match(output.aeo_quick_summary, /Quilt/);
  assert.match(output.aeo_quick_summary, /Duvet Cover/);

  // 5. AEO FAQ
  assert.ok(output.aeo_faq);
  assert.equal(output.aeo_faq.length, 4);
  const diffFaq = output.aeo_faq.find((f) => /difference between/i.test(f.question));
  assert.ok(diffFaq, "AEO FAQ must include difference question for Bedding options");
  assert.match(diffFaq.answer, /Comforter/);
  assert.match(diffFaq.answer, /Quilt/);
  assert.match(diffFaq.answer, /Duvet Cover/);
});

test("Full SEO pipeline with domain alias 'b6-theme-test.myshopify.com' resolves Jeminise Bedding Profile", async () => {
  const result = await runSeoContentDetailed({
    siteDomain: "b6-theme-test.myshopify.com",
    title: "Celtic Tree of Life Bedding Set",
    description: "Celtic Tree of Life patterned quilt and comforter set.",
    handle: "celtic-tree-of-life-bedding-set",
    niche: "Bedding Sets",
    images: [{ url: "https://b6-theme-test.myshopify.com/cdn/celtic.jpg" }],
  }, { imageMode: "alt_only" });

  const output = result.output;
  assert.match(output.productDescription, /Available Styles/i);
  assert.match(output.productDescription, /<strong>Comforter:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Quilt:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Duvet Cover:<\/strong>/i);
  assert.ok(output.productSeoDescription.includes("Comforter"));
  assert.ok(output.productSeoDescription.includes("Quilt"));
  assert.ok(output.productSeoDescription.includes("Duvet Cover"));
  assert.ok(output.productSeoDescription.length <= 160);
});

test("Full SEO pipeline with storeId 'jeminise' resolves Jeminise Bedding Profile", async () => {
  const result = await runSeoContentDetailed({
    storeId: "jeminise",
    title: "Raven Shield Bedding Set",
    description: "Raven shield bedding decor.",
    handle: "raven-shield-bedding-set",
    niche: "Bedding Sets",
    images: [{ url: "https://cdn.shopify.com/raven.jpg" }],
  }, { imageMode: "alt_only" });

  const output = result.output;
  assert.match(output.productDescription, /Available Styles/i);
  assert.match(output.productDescription, /<strong>Comforter:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Quilt:<\/strong>/i);
  assert.match(output.productDescription, /<strong>Duvet Cover:<\/strong>/i);
  assert.ok(output.productSeoDescription.includes("Comforter"));
  assert.ok(output.productSeoDescription.includes("Quilt"));
  assert.ok(output.productSeoDescription.includes("Duvet Cover"));
});
