import assert from "node:assert/strict";
import test from "node:test";

import { checkClaimGrounding } from "../internal/content-generation/claim-guard";
import { fitProductTitle, fitSeoDescription, fitSeoTitle } from "../internal/content-generation/content-fitters";
import { canonicalizeBulletLabel, escapeHtml, formatProductDescriptionHtml } from "../internal/content-generation/html-description-formatter";
import { cleanSlug, generateProductHandle } from "../internal/content-generation/slug-utils";
import type { ContentFactSheet, GeneratedContentDraft } from "../internal/content-generation/content-generation-types";

test("B5 slug utilities preserve boundaries and the configured existing handle", () => {
  const input = "Áo Thun Halloween Mèo Đen Vintage 2026 - Limited Edition!";
  assert.equal(cleanSlug(input), "ao-thun-halloween-meo-den-vintage-2026-limited-edition");
  assert.equal(generateProductHandle(input, { existingHandle: "my-existing-custom-handle", preserveExisting: true }), "my-existing-custom-handle");
  assert.equal(generateProductHandle(input, { existingHandle: "my-existing-custom-handle", preserveExisting: false }), "ao-thun-halloween-meo-den-vintage-2026-limited-edition");
  assert.ok(cleanSlug("this-is-an-extremely-long-product-handle-name-designed-to-test-the-strict-eighty-character-length-limit-safely", 80).length <= 80);
});

test("B5 HTML formatter escapes unsafe markup and removes promotional labels", () => {
  assert.ok(!escapeHtml('<script>alert("XSS")</script>').includes("<script>"));
  const draft: GeneratedContentDraft = { productTitle: "Test Product", intro: 'Intro with <img src="x" onerror="alert(1)"> tag', bullets: [{ label: "BEST VALUE DEAL", text: "Bullet text with <style>body{}</style>" }], guidance: ["Care tip 1"], closing: "Closing text", productSeoTitle: "Test SEO Title", productSeoDescription: "Test SEO Description" };
  const html = formatProductDescriptionHtml(draft);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<style>"));
  assert.equal(canonicalizeBulletLabel("BEST VALUE DEAL"), "Details");
});

test("B5 fitters respect SEO and product title bounds", () => {
  assert.ok(fitSeoTitle("Vintage Black Cat Halloween T-Shirt | Spooky Retro Aesthetic Graphic Tee for Cat Lovers - Best Sale", "vintage black cat halloween t-shirt", 70).length <= 70);
  assert.ok(fitSeoDescription("Celebrate spooky season in effortless style with this vintage black cat Halloween t-shirt. Specially designed with vibrant retro artwork and durable materials, this shirt is sure to impress everyone at the party while providing day-long comfort. Explore our collection today!", 160).length <= 160);
  assert.ok(fitProductTitle("Vintage Retro Black Cat Graphic T-Shirt Spooky Halloween Costume Apparel for Cat Owners Men and Women", 80).length <= 80);
});

test("B5 claim guard rejects unsupported high-risk and personalization claims", () => {
  const baseFacts: ContentFactSheet = { originalTitle: "Casual Cotton T-Shirt", originalDescription: "Comfortable everyday tee with graphic print.", typographyVisibleTexts: ["MEOW"], visualEntities: "cat", physicalProductIdentity: "t-shirt", targetAudience: ["cat lovers"], occasions: ["casual"], useCases: ["daily wear"], personalizationSupported: false };
  const violatingDraft: GeneratedContentDraft = { productTitle: "Personalized Genuine Leather Cat Tee", intro: "Crafted from genuine leather with waterproof coating. Add your name for free!", bullets: [{ label: "Material", text: "100% cashmere with lifetime warranty" }, { label: "Delivery", text: "Includes free shipping worldwide" }], guidance: [], closing: "Order your custom name shirt today.", productSeoTitle: "Personalized Genuine Leather Cat Tee", productSeoDescription: "Shop this waterproof tee with free shipping." };
  const violations = checkClaimGrounding(violatingDraft, baseFacts);
  assert.ok(violations.some((value) => value.includes("genuine leather")));
  assert.ok(violations.some((value) => value.includes("waterproof")));
  assert.ok(violations.some((value) => value.includes("free shipping")));
  assert.ok(violations.some((value) => value.includes("personalization")));
});

test("B5 claim guard detects unsupported claims inside aeo_quick_summary and aeo_faq", () => {
  const baseFacts: ContentFactSheet = {
    originalTitle: "Viking Blanket",
    originalDescription: "Cozy polyester throw blanket with Nordic art.",
    typographyVisibleTexts: [],
    visualEntities: "raven",
    physicalProductIdentity: "fleece blanket",
    targetAudience: ["mythology fans"],
    occasions: [],
    useCases: ["living room"],
    personalizationSupported: false,
  };

  const draftWithAeoViolation: GeneratedContentDraft = {
    productTitle: "Viking Blanket",
    intro: "Cozy blanket with raven art.",
    bullets: [
      { label: "Design", text: "Raven art." },
      { label: "Style", text: "Nordic." },
    ],
    guidance: [],
    closing: "Great gift.",
    productSeoTitle: "Viking Blanket",
    productSeoDescription: "Cozy blanket.",
    aeo_quick_summary: "This blanket is crafted with genuine leather trim and 100% cashmere for ultimate luxury.",
    aeo_faq: [
      {
        question: "Can I personalize this blanket?",
        answer: "Yes, you can add your custom name or personalized text easily.",
      },
    ],
  };

  const violations = checkClaimGrounding(draftWithAeoViolation, baseFacts);
  assert.ok(violations.some((v) => v.includes("genuine leather")), "Must flag genuine leather in quick summary");
  assert.ok(violations.some((v) => v.includes("personalization")), "Must flag personalization claim in FAQ");
});

test("B5 HeuristicContentGenerator safely handles leather goods without false-positive claim violations", async () => {
  const { HeuristicContentGenerator } = await import("../internal/content-generation/heuristic-content-generator");
  const leatherFacts: ContentFactSheet = {
    originalTitle: "Vintage Leather Messenger Bag for Men",
    originalDescription: "Brown leather bag with multiple compartments. Wipe clean.",
    typographyVisibleTexts: [],
    visualEntities: "brass buckle",
    physicalProductIdentity: "leather bag",
    targetAudience: ["professionals"],
    occasions: [],
    useCases: ["office commuting"],
    personalizationSupported: false,
  };

  const generator = new HeuristicContentGenerator();
  const draft = await generator.generate({
    facts: leatherFacts,
    keywords: {
      primary: "vintage leather messenger bag",
      secondary: ["office commuting bag"],
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

  const violations = checkClaimGrounding(draft, leatherFacts);
  assert.equal(violations.length, 0, "Heuristic generator must not trigger false positive claim violations for leather items");
  assert.ok(draft.aeo_quick_summary);
  assert.doesNotMatch(draft.aeo_quick_summary, /\bauthentic\s+leather\b/i);
});
