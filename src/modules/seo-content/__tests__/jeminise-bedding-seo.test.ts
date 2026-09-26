import assert from "node:assert/strict";
import test from "node:test";

import { runSeoContentDetailed } from "../service";
import { JEMINISE_BEDDING_PROFILE, sanitizeBeddingTitle } from "../internal/store-profiles";
import {
  HeuristicContentGenerator,
  buildBeddingSeoDescription,
} from "../internal/content-generation/heuristic-content-generator";
import { GeminiSeoContentGenerator } from "../internal/content-generation/gemini-content-generator";
import { formatProductDescriptionHtml } from "../internal/content-generation/html-description-formatter";
import { checkClaimGrounding } from "../internal/content-generation/claim-guard";
import type { ContentFactSheet } from "../internal/content-generation/content-generation-types";

test("buildBeddingSeoDescription produces descriptions containing all 3 keywords strictly within 155-160 chars across all title lengths", () => {
  const titles = [
    "Viking Quilt",
    "Viking Quilt Bedding",
    "Dragon Bedding Set",
    "Viking Quilt Bedding Set",
    "Vintage Celtic Tree of Life Bedding Set",
    "Gothic Skull and Raven Floral Bedding Set",
    "Nordic Viking Raven Vegvisir Compass Bedding Set",
    "Norse Mythology Odin Ravens Tree of Life Quilt Bedding Set",
    "Ultra Long Product Title With Many Descriptive Words And Viking Mythology Symbols",
    "Super Extra Long Medieval Viking Valkyrie Battle Armor Bedroom Quilt Comforter Blanket Set",
  ];

  for (const title of titles) {
    const desc = buildBeddingSeoDescription(title, "Odin & Ravens", 160);
    assert.ok(
      desc.length <= 160,
      `Description length ${desc.length} exceeds 160 for title "${title}": "${desc}"`,
    );
    assert.ok(
      desc.length >= 155,
      `Description length ${desc.length} strictly less than 155 for title "${title}": "${desc}"`,
    );
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
  assert.ok(draft.productSeoDescription.length >= 155);

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
  assert.ok(output.productSeoDescription.length >= 155);

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

test("sanitizeBeddingTitle strips forced bedding style options while preserving artwork", () => {
  const cases = [
    {
      input: "Viking Dragon Bedding Set - Comforter, Quilt, Duvet Cover",
      expected: "Viking Dragon Bedding Set",
    },
    {
      input: "Viking Dragon Bedding Set (Comforter, Quilt, or Duvet Cover)",
      expected: "Viking Dragon Bedding Set",
    },
    {
      input: "Comforter, Quilt, Duvet Cover - Viking Dragon Bedding Set",
      expected: "Viking Dragon Bedding Set",
    },
    {
      input: "Viking Dragon Bedding Set Comforter Quilt Duvet Cover",
      expected: "Viking Dragon Bedding Set",
    },
    {
      input: "Viking Dragon Bedding Set, Comforter, Quilt, Duvet Cover - King",
      expected: "Viking Dragon Bedding Set - King",
    },
    {
      input: "Viking Dragon Bedding Set",
      expected: "Viking Dragon Bedding Set",
    },
  ];

  for (const c of cases) {
    const actual = sanitizeBeddingTitle(c.input);
    assert.equal(actual, c.expected, `Failed for input: "${c.input}"`);
  }
});

test("GeminiSeoContentGenerator sanitizes flawed Gemini draft: cleans title, restores 155-160 char seo description, and injects FAQ difference question", async () => {
  const mockSdk = {
    async generateStructuredText() {
      return {
        rawText: JSON.stringify({
          productTitle: "Viking Dragon Bedding Set - Comforter, Quilt, Duvet Cover",
          intro: "An impressive bedding set for Viking lovers.",
          bullets: [
            { label: "Design", text: "Vivid dragon graphic design." },
            { label: "Materials", text: "Premium microfiber fabric." },
          ],
          guidance: ["Machine wash cold."],
          closing: "Order this great set today.",
          productSeoTitle: "Viking Dragon Bedding Set (Comforter, Quilt, Duvet Cover) | Shop",
          productSeoDescription: "An ordinary description missing style keywords.",
          aeo_quick_summary: "Generic summary without mentioning style options.",
          aeo_faq: [
            { question: "Is this durable?", answer: "Yes, very durable." },
            { question: "Can I return it?", answer: "Check return policy." },
          ],
          styleOptions: [
            { name: "Single Style", description: "Incomplete single style" },
          ],
        }),
      };
    },
    async generateProductImageAnalysis() {
      throw new Error("Not implemented");
    },
  };

  const generator = new GeminiSeoContentGenerator(mockSdk);
  const facts: ContentFactSheet = {
    originalTitle: "Viking Dragon Bedding Set",
    originalDescription: "Detailed dragon artwork.",
    niche: "Bedding & Home Decor",
    physicalProductIdentity: "bedding set",
    typographyVisibleTexts: [],
    targetAudience: ["Viking lovers"],
    occasions: [],
    useCases: [],
    personalizationSupported: false,
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };

  const draft = await generator.generate({
    facts,
    keywords: {
      primary: "Viking Bedding",
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

  // 1. Titles sanitized: no forced style list
  assert.equal(draft.productTitle.includes("Comforter, Quilt, Duvet Cover"), false);
  assert.equal(draft.productTitle, "Viking Dragon Bedding Set");
  assert.equal(draft.productSeoTitle.includes("Comforter, Quilt, Duvet Cover"), false);

  // 2. SEO Description contains all 3 styles and length in [155, 160]
  assert.ok(draft.productSeoDescription.includes("Comforter"));
  assert.ok(draft.productSeoDescription.includes("Quilt"));
  assert.ok(draft.productSeoDescription.includes("Duvet Cover"));
  assert.ok(draft.productSeoDescription.length <= 160);
  assert.ok(draft.productSeoDescription.length >= 155);

  // 3. Style Options restored to all 3 options
  assert.ok(draft.styleOptions);
  assert.equal(draft.styleOptions.length, 3);
  assert.deepEqual(
    draft.styleOptions.map((o) => o.name),
    ["Comforter", "Quilt", "Duvet Cover"],
  );

  // 4. AEO Quick summary restored with 3 options
  assert.ok(draft.aeo_quick_summary);
  assert.match(draft.aeo_quick_summary, /Comforter/);
  assert.match(draft.aeo_quick_summary, /Quilt/);
  assert.match(draft.aeo_quick_summary, /Duvet Cover/);

  // 5. AEO FAQ has the difference question injected
  assert.ok(draft.aeo_faq);
  const diffItem = draft.aeo_faq.find((f) => /difference between/i.test(f.question));
  assert.ok(diffItem, "FAQ difference question must be present");
  assert.match(diffItem.answer, /Comforter/);
  assert.match(diffItem.answer, /Quilt/);
  assert.match(diffItem.answer, /Duvet Cover/);
});

test("Claim guard allows machine washable for bedding store profile", () => {
  const facts: ContentFactSheet = {
    originalTitle: "Viking Bedding Set",
    originalDescription: "Fine bedding set.",
    niche: "Bedding & Home Decor",
    physicalProductIdentity: "bedding set",
    typographyVisibleTexts: [],
    targetAudience: [],
    occasions: [],
    useCases: [],
    personalizationSupported: false,
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };

  const draft = {
    productTitle: "Viking Bedding Set",
    intro: "A premium machine washable bedding set.",
    bullets: [
      { label: "Care", text: "Machine washable construction for effortless maintenance." },
      { label: "Fabric", text: "Hypoallergenic ultra-soft brushed microfiber." },
    ],
    guidance: ["Machine wash cold on gentle cycle."],
    closing: "Enjoy long-lasting quality.",
    productSeoTitle: "Viking Bedding Set | Shop Online",
    productSeoDescription: "Discover this Viking Bedding Set. Available in Comforter, Quilt, or Duvet Cover styles. Crafted from premium microfiber with vibrant colors and easy care. Shop online!",
  };

  const violations = checkClaimGrounding(draft, facts);
  assert.deepEqual(violations, [], `Expected no violations but got: ${violations.join(", ")}`);
});

