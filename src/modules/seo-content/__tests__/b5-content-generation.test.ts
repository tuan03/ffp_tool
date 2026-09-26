import assert from "node:assert/strict";
import test from "node:test";

import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { HeuristicContentGenerator } from "../internal/content-generation/heuristic-content-generator";
import { extractVisionDesignConcept } from "../internal/content-generation/heuristic-title-builder";
import { createInitialContext } from "../internal/pipeline-context";

test("B5 fact sheet excludes scene context and only supplies product-safe B1 evidence", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({ title: "Music Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] }),
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: ["Song Title"], styleSummary: "white media-player labels" },
      visualEntities: "Media player interface with a cloud-head portrait.",
      sceneContext: "Home studio with guitars and plants.",
    },
  });
  assert.equal("sceneContext" in facts, false);
  const draft = await new HeuristicContentGenerator().generate({
    facts,
    keywords: { primary: "personalized music rug", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });
  assert.doesNotMatch(`${draft.intro} ${draft.closing}`, /guitar|plant|studio/i);
});

test("B5 HeuristicContentGenerator preserves variantLabel in fact sheet and title builder", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({
      title: "Personalized Christian Handbag Set",
      description: "",
      niche: "handbag set",
      handle: "christian-handbag-set",
      images: [],
      variantLabel: "Pink Faith",
    }),
    productUnderstanding: {
      physicalProductIdentity: "handbag set",
      typography: { visibleTexts: [], styleSummary: "" },
      visualEntities: "Handbag set with wallet",
      sceneContext: "",
    },
  });


  assert.equal(facts.variantLabel, "Pink Faith");

  const draft = await new HeuristicContentGenerator().generate({
    facts,
    keywords: { primary: "christian faux leather handbag set", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });

  assert.match(draft.productTitle, /Pink Faith/);
  assert.match(draft.productSeoDescription, /Pink Faith/);
  assert.ok(draft.productSeoDescription.length <= 160);
  assert.ok(draft.bullets.some((b) => b.text.includes("Pink Faith")));
});

test("B5 HeuristicContentGenerator enriches title and SEO title using visualEntities and typographyVisibleTexts", async () => {
  const facts1 = buildContentFactSheet({
    ...createInitialContext({
      title: "Viking Bedding Set Quilt Comforter with Pillowcases - Pattern 01",
      description: "Viking comforter bedding set with pillowcases",
      niche: "bedding",
      handle: "viking-bedding-set-1",
      images: [],
      variantLabel: "Pattern 01",
    }),
    productUnderstanding: {
      physicalProductIdentity: "quilt bedding set",
      typography: { visibleTexts: ["VALHALLA"], styleSummary: "bold runic lettering" },
      visualEntities: "Valhalla Viking Shield with Crossed Battle Axes",
      sceneContext: "Bedroom",
    },
  });

  const facts2 = buildContentFactSheet({
    ...createInitialContext({
      title: "Viking Bedding Set Quilt Comforter with Pillowcases - Pattern 02",
      description: "Viking comforter bedding set with pillowcases",
      niche: "bedding",
      handle: "viking-bedding-set-2",
      images: [],
      variantLabel: "Pattern 02",
    }),
    productUnderstanding: {
      physicalProductIdentity: "quilt bedding set",
      typography: { visibleTexts: [], styleSummary: "" },
      visualEntities: "Thor Mjolnir Skull Hammer with lightning",
      sceneContext: "Bedroom",
    },
  });

  const generator = new HeuristicContentGenerator();
  const constraints = { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true };

  const draft1 = await generator.generate({
    facts: facts1,
    keywords: { primary: "viking bedding set", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints,
  });

  const draft2 = await generator.generate({
    facts: facts2,
    keywords: { primary: "viking bedding set", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints,
  });

  // Verify Product Titles are enriched and distinct
  assert.match(draft1.productTitle, /Valhalla/i);
  assert.match(draft1.productTitle, /Shield/i);
  // Verify theme word is not awkwardly repeated like "Viking Valhalla Viking"
  assert.doesNotMatch(draft1.productTitle, /Viking\s+Valhalla\s+Viking/i);
  assert.match(draft2.productTitle, /Thor/i);
  assert.match(draft2.productTitle, /Mjolnir/i);
  assert.notEqual(draft1.productTitle, draft2.productTitle);

  // Verify SEO Titles are vision-driven and distinct
  assert.match(draft1.productSeoTitle, /Valhalla/i);
  assert.match(draft2.productSeoTitle, /Thor/i);
  assert.doesNotMatch(draft1.productSeoTitle, /Viking.*Viking/i);
  assert.notEqual(draft1.productSeoTitle, draft2.productSeoTitle);
  assert.ok(draft1.productSeoTitle.length <= 70);
  assert.ok(draft2.productSeoTitle.length <= 70);
});

test("B5 extractVisionDesignConcept safely rejects placeholder values like 'unknown.', 'None.', 'N/A'", () => {
  assert.equal(
    extractVisionDesignConcept({
      typographyVisibleTexts: [],
      visualEntities: "unknown.",
    }),
    undefined,
  );

  assert.equal(
    extractVisionDesignConcept({
      typographyVisibleTexts: ["unknown."],
      visualEntities: "none",
    }),
    undefined,
  );

  assert.equal(
    extractVisionDesignConcept({
      typographyVisibleTexts: ["N/A"],
      visualEntities: "Not Applicable",
    }),
    undefined,
  );
});

test("B5 HeuristicContentGenerator does not truncate distinctive suffix mid-word in SEO Title", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({
      title: "Viking Bedding Set Quilt Comforter",
      description: "Viking bedding set",
      niche: "bedding",
      handle: "viking-bedding-set",
      images: [],
    }),
    productUnderstanding: {
      physicalProductIdentity: "quilt bedding set",
      typography: { visibleTexts: [], styleSummary: "" },
      visualEntities: "Valhalla Viking Round Shield with Crossed Battle Axes",
      sceneContext: "Bedroom",
    },
  });

  const generator = new HeuristicContentGenerator();
  const draft = await generator.generate({
    facts,
    keywords: { primary: "viking bedding set", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });

  // Verify SEO Title does not contain broken words like "Round Sh"
  assert.doesNotMatch(draft.productSeoTitle, /\bRound\s+Sh\b/);
  assert.ok(draft.productSeoTitle.length <= 70);
});

test("B5 HeuristicContentGenerator generates full AEO suite with quick summary, 4 strategic FAQs, and Schema.org JSON-LD @graph", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({
      title: "Viking Quilt Bed Set - Viking-03",
      description: "Machine wash cold gentle cycle. Microfiber bedding.",
      niche: "bedding",
      handle: "viking-quilt-bed-set-viking-03",
      images: [],
      variantLabel: "Viking-03",
    }),
    productUnderstanding: {
      physicalProductIdentity: "quilt bed set",
      typography: { visibleTexts: ["VALHALLA"], styleSummary: "Nordic runes" },
      visualEntities: "Thor Mjolnir skull hammer with Celtic knotwork and ravens",
      sceneContext: "Bedroom",
    },
    shoppingContext: {
      targetAudience: ["Norse mythology enthusiasts"],
      suitableOccasions: ["Housewarming"],
      useCases: ["master bedroom decor"],
      buyerIntentKeywords: ["viking quilt set"],
    },
  });

  const generator = new HeuristicContentGenerator();
  const draft = await generator.generate({
    facts,
    keywords: { primary: "viking quilt bed set", secondary: ["all-season bedding"], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });

  // 1. aeo_quick_summary checks
  assert.ok(draft.aeo_quick_summary, "aeo_quick_summary must be defined");
  const words = draft.aeo_quick_summary.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 30 && words.length <= 80, `Quick summary word count ${words.length} should be ~40-70 words`);
  assert.match(draft.aeo_quick_summary, /Viking-03/);
  assert.match(draft.aeo_quick_summary, /Thor Mjolnir skull hammer/);
  assert.match(draft.aeo_quick_summary, /quilt bed set/i);

  // 2. aeo_faq checks: exactly 4 strategic questions
  assert.ok(Array.isArray(draft.aeo_faq), "aeo_faq must be an array");
  assert.equal(draft.aeo_faq.length, 4, "aeo_faq must contain exactly 4 Q&As");

  // Q1: Pre-purchase intent
  assert.match(draft.aeo_faq[0].question, /How do I choose the right/i);
  assert.ok(draft.aeo_faq[0].answer.length > 20);

  // Q2: Usability/Durability adapted for bedding
  assert.match(draft.aeo_faq[1].question, /all-season|comfort/i);
  assert.match(draft.aeo_faq[1].answer, /warmth|breathable|season/i);

  // Q3: Care/Cleaning since personalizationSupported is false
  assert.match(draft.aeo_faq[2].question, /cleaned|maintained/i);
  assert.doesNotMatch(draft.aeo_faq[2].answer, /personalize|customized name/i);

  // Q4: USP Differentiation
  assert.match(draft.aeo_faq[3].question, /different from similar products/i);
  assert.match(draft.aeo_faq[3].answer, /Thor Mjolnir skull hammer/);

  // 3. aeo_json_ld checks: Schema.org @graph [Product, FAQPage]
  assert.ok(draft.aeo_json_ld, "aeo_json_ld must be defined");
  const parsedJsonLd = JSON.parse(draft.aeo_json_ld);
  assert.equal(parsedJsonLd["@context"], "https://schema.org");
  assert.ok(Array.isArray(parsedJsonLd["@graph"]));
  assert.equal(parsedJsonLd["@graph"].length, 2);

  const productEntity = parsedJsonLd["@graph"].find((item: { "@type": string }) => item["@type"] === "Product");
  assert.ok(productEntity, "JSON-LD graph must include Product entity");
  assert.equal(productEntity.name, draft.productTitle);

  const faqEntity = parsedJsonLd["@graph"].find((item: { "@type": string }) => item["@type"] === "FAQPage");
  assert.ok(faqEntity, "JSON-LD graph must include FAQPage entity");
  assert.equal(faqEntity.mainEntity.length, 4);
  assert.equal(faqEntity.mainEntity[0]["@type"], "Question");
  assert.equal(faqEntity.mainEntity[0].acceptedAnswer["@type"], "Answer");
});

test("B5 HeuristicContentGenerator adapts FAQ Q2 and Q3 for rugs and personalization", async () => {
  const rugFacts = buildContentFactSheet({
    ...createInitialContext({
      title: "Custom Vintage Cat Rug",
      description: "Low-pile washable rug.",
      niche: "custom rug",
      handle: "custom-vintage-cat-rug",
      images: [],
    }),
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "" },
      visualEntities: "Vintage black cat silhouette",
      sceneContext: "",
    },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: [],
      useCases: ["living room entryway"],
      buyerIntentKeywords: [],
    },
  });

  const rugFactsWithCustom = {
    ...rugFacts,
    personalizationSupported: true,
  };

  const generator = new HeuristicContentGenerator();
  const draft = await generator.generate({
    facts: rugFactsWithCustom,
    keywords: { primary: "custom vintage cat rug", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });

  assert.ok(draft.aeo_faq);
  assert.equal(draft.aeo_faq.length, 4);

  // Q2: Rug adapted
  assert.match(draft.aeo_faq[1].question, /high-traffic/i);
  assert.match(draft.aeo_faq[1].answer, /low-pile|foot traffic/i);

  // Q3: Personalization supported
  assert.match(draft.aeo_faq[2].question, /personalize|customize/i);
  assert.match(draft.aeo_faq[2].answer, /personalization/i);
});




