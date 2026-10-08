import assert from "node:assert/strict";
import { test } from "node:test";
import { validateExternalSeoAnalysis, finalizeExternalSeo, bindExternalSeoProduct } from "../external-seo";
import { FileSeoConflictCorpus } from "../internal/conflict-control/file-seo-conflict-corpus";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_STORE_PROFILE } from "./test-profile";

const input = { niche: "rugs", storeProfile: TEST_STORE_PROFILE, images: [{ id: "front", url: "https://example.com/front.jpg" }] };
const execution = { storeId: "test", productId: "1", source: "auto_seo" as const, sourceIdentity: "product-1", providerId: "codex_mcp", pipelineVersion: "seo-b1-b6-v2", originalSnapshot: {} };

test("external analysis requires evidence for every supplied image", () => {
  assert.throws(() => validateExternalSeoAnalysis(input, { physicalProductIdentity: "rug", evidence: [] }), /image|evidence/i);
});

test("external analysis separates buyer customization samples from fixed design text", () => {
  const analysis = validateExternalSeoAnalysis(input, {
    physicalProductIdentity: "bedding",
    visualEntities: "dark baseball batter artwork",
    sceneContext: "bedroom mockup",
    typography: {
      visibleTexts: ["WILLIAM", "33", "BASEBALL"],
      customizationSampleTexts: ["WILLIAM", "33"],
      styleSummary: "outlined varsity lettering",
    },
    shoppingContext: { targetAudience: ["baseball fans"], suitableOccasions: [], useCases: ["bedroom decor"], buyerIntentKeywords: [] },
    evidence: [{ imageId: "front", observation: "The mockup shows WILLIAM and 33 as editable name and player-number examples." }],
  });

  assert.deepEqual(analysis.understanding.typography.visibleTexts, ["BASEBALL"]);
  assert.deepEqual(analysis.understanding.typography.customizationSampleTexts, ["WILLIAM", "33"]);
});

test("external SEO finalizes without any network and preserves old product keywords", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "external-seo-"));
  const corpus = new FileSeoConflictCorpus({ filePath: path.join(directory, "corpus.json"), maxRegisteredKeywordsPerProduct: 1024 });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected paid or network provider call"); });
  try {
    await corpus.upsertProduct({ identity: { storeId: "test", productId: "1", handle: "cotton-rug" }, approvedKeywords: ["cotton floor rug"] });
    const analysis = { physicalProductIdentity: "rug", visualEntities: "geometric pattern", sceneContext: "Product on a plain background", typography: { visibleTexts: [], styleSummary: "No visible text" }, shoppingContext: { targetAudience: ["homeowners"], suitableOccasions: [], useCases: ["floor decor"], buyerIntentKeywords: ["geometric rug"] }, evidence: [{ imageId: "front", observation: "Geometric pattern on the rug" }] };
    const submission = { draft: { productTitle: "Geometric cotton rug", intro: "A cotton rug with a geometric design.", bullets: [{ label: "Material", text: "Cotton" }, { label: "Design", text: "Geometric pattern" }], closing: "Explore this geometric rug for your home.", productSeoTitle: "Geometric cotton rug", productSeoDescription: "Discover a cotton rug with a geometric pattern for your home.", aeo_quick_summary: "This cotton rug features a visible geometric pattern designed for floor decor in the home. Its grounded design details make it suitable for homeowners seeking a straightforward geometric accent without unsupported material, performance, care, or durability claims. The cotton material and visible pattern are the only verified product characteristics included.", aeo_faq: [{ question: "What is this product?", answer: "It is a cotton rug with a geometric design." }, { question: "Where can this rug be used?", answer: "The supplied product information presents it as floor decor for the home." }, { question: "What design is visible?", answer: "The product image shows a geometric pattern on the rug." }] }, alts: { front: "Cotton rug with a geometric pattern" } };
    const result = await finalizeExternalSeo(input, analysis, { keywords: ["geometric cotton rug"], reason: "Matches the source material and visible pattern." }, submission, { execution, corpus });
    assert.equal(result.metadata.engine, "custom_gpt");
    assert.equal(result.output.images[0]?.alt, submission.alts.front);
    assert.equal(result.output.aeo_faq?.length, 3);
    assert.match(result.output.aeo_json_ld ?? "", /FAQPage/);
    assert.ok((await corpus.getSnapshot()).products[0]?.keywords.some(keyword => keyword.keyword === "cotton floor rug"));
    await assert.rejects(finalizeExternalSeo(input, analysis, { keywords: ["geometric cotton rug"], reason: "same" }, submission, { execution: { ...execution, productId: "2", sourceIdentity: "product-2" }, corpus }), /conflict/i);
    await assert.rejects(finalizeExternalSeo(input, analysis, { keywords: ["geometric cotton rug"], reason: "same" }, { ...submission, draft: { ...submission.draft, intro: "Guaranteed waterproof rug" } }, { execution, corpus }), /grounding|claim/i);
    const personalizationAnalysis = {
      ...analysis,
      typography: { visibleTexts: ["WILLIAM", "33"], customizationSampleTexts: ["WILLIAM", "33"], styleSummary: "outlined varsity lettering" },
    };
    await assert.rejects(
      finalizeExternalSeo(input, personalizationAnalysis, { keywords: ["geometric cotton rug"], reason: "same" }, {
        ...submission,
        draft: { ...submission.draft, productTitle: "William 33 geometric rug" },
      }, { execution, corpus }),
      /customization sample/i,
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("external SEO rejects drafts without the complete AEO contract", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "external-seo-aeo-"));
  const corpus = new FileSeoConflictCorpus({ filePath: path.join(directory, "corpus.json") });
  try {
    const analysis = { physicalProductIdentity: "rug", visualEntities: "geometric pattern", sceneContext: "Product on a plain background", typography: { visibleTexts: [], styleSummary: "No visible text" }, shoppingContext: { targetAudience: ["homeowners"], suitableOccasions: [], useCases: ["floor decor"], buyerIntentKeywords: ["geometric rug"] }, evidence: [{ imageId: "front", observation: "Geometric pattern on the rug" }] };
    const submission = { draft: { productTitle: "Geometric cotton rug", intro: "A cotton rug with a geometric design.", bullets: [{ label: "Material", text: "Cotton" }, { label: "Design", text: "Geometric pattern" }], closing: "Explore this geometric rug for your home.", productSeoTitle: "Geometric cotton rug", productSeoDescription: "Discover a cotton rug with a geometric pattern for your home." }, alts: { front: "Cotton rug with a geometric pattern" } };

    await assert.rejects(
      finalizeExternalSeo(input, analysis, { keywords: ["geometric cotton rug"], reason: "Grounded target." }, submission, { execution: { ...execution, productId: "aeo-1" }, corpus }),
      /aeo_quick_summary/i,
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("external analysis rejects evidence for another product image", () => {
  assert.throws(() => validateExternalSeoAnalysis(input, { physicalProductIdentity: "rug", evidence: [{ imageId: "wrong", observation: "red" }] }), /image|evidence/i);
});

test("Amazon keyword ownership follows the Shopify identity without losing existing targets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "external-seo-binding-"));
  const corpus = new FileSeoConflictCorpus({ filePath: path.join(directory, "corpus.json") });
  try {
    await corpus.upsertProduct({ identity: { storeId: "test", productId: "amazon:source-1" }, approvedKeywords: ["cotton rug"] });
    await corpus.upsertProduct({ identity: { storeId: "test", productId: "42" }, approvedKeywords: ["woven rug"] });
    await bindExternalSeoProduct({ storeId: "test", sourceIdentity: "source-1", productId: "gid://shopify/Product/42" }, corpus);
    await bindExternalSeoProduct({ storeId: "test", sourceIdentity: "source-1", productId: "42" }, corpus);
    const snapshot = await corpus.getSnapshot();
    assert.equal(snapshot.products.length, 1);
    assert.equal(snapshot.products[0]?.productId, "42");
    assert.deepEqual(snapshot.products[0]?.keywords.map(keyword => keyword.keyword).sort(), ["cotton rug", "woven rug"]);
    assert.equal((await corpus.findConflicts({ keyword: "cotton rug", owner: { storeId: "test", productId: "42" } })).length, 0);
    assert.equal((await corpus.findConflicts({ keyword: "cotton rug", owner: { storeId: "test", productId: "99" } })).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
