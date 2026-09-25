import assert from "node:assert/strict";
import test from "node:test";

import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { HeuristicContentGenerator } from "../internal/content-generation/heuristic-content-generator";
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
  assert.match(draft2.productTitle, /Thor/i);
  assert.match(draft2.productTitle, /Mjolnir/i);
  assert.notEqual(draft1.productTitle, draft2.productTitle);

  // Verify SEO Titles are vision-driven and distinct
  assert.match(draft1.productSeoTitle, /Valhalla/i);
  assert.match(draft2.productSeoTitle, /Thor/i);
  assert.notEqual(draft1.productSeoTitle, draft2.productSeoTitle);
  assert.ok(draft1.productSeoTitle.length <= 70);
  assert.ok(draft2.productSeoTitle.length <= 70);
});



