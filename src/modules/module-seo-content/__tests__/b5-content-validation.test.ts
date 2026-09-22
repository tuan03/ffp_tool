import test from "node:test";
import assert from "node:assert/strict";

import { cleanSlug, generateProductHandle } from "../internal/content-generation/slug-utils";
import {
  canonicalizeBulletLabel,
  escapeHtml,
  formatProductDescriptionHtml,
} from "../internal/content-generation/html-description-formatter";
import {
  fitProductTitle,
  fitSeoDescription,
  fitSeoTitle,
} from "../internal/content-generation/content-fitters";
import { checkClaimGrounding } from "../internal/content-generation/claim-guard";
import type {
  ContentFactSheet,
  GeneratedContentDraft,
} from "../internal/content-generation/content-generation-types";

test("Slug Utils: normalizes diacritics, special characters, and preserves token boundaries", () => {
  const input = "Áo Thun Halloween Mèo Đen Vintage 2026 - Limited Edition!";
  const slug = cleanSlug(input);

  assert.equal(slug, "ao-thun-halloween-meo-den-vintage-2026-limited-edition");

  // Preserves existing handle when requested
  const preserved = generateProductHandle(input, {
    existingHandle: "my-existing-custom-handle",
    preserveExisting: true,
  });
  assert.equal(preserved, "my-existing-custom-handle");

  // Re-slugs when preserveExisting is false
  const regenerated = generateProductHandle(input, {
    existingHandle: "my-existing-custom-handle",
    preserveExisting: false,
  });
  assert.equal(regenerated, "ao-thun-halloween-meo-den-vintage-2026-limited-edition");

  // Strict <= 80 characters ceiling without cutting word tokens
  const longPhrase =
    "this-is-an-extremely-long-product-handle-name-designed-to-test-the-strict-eighty-character-length-limit-safely";
  const limitedSlug = cleanSlug(longPhrase, 80);
  assert.ok(limitedSlug.length <= 80);
  assert.ok(!limitedSlug.endsWith("-"));
});

test("HTML Formatter: strictly escapes special characters and prevents XSS", () => {
  const maliciousText = '<script>alert("XSS")</script> & "quotes" \'apostrophe\'';
  const escaped = escapeHtml(maliciousText);

  assert.ok(!escaped.includes("<script>"));
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(escaped.includes("&amp;"));
  assert.ok(escaped.includes("&quot;quotes&quot;"));
  assert.ok(escaped.includes("&#39;apostrophe&#39;"));

  const draft: GeneratedContentDraft = {
    productTitle: "Test Product",
    intro: 'Intro with <img src="x" onerror="alert(1)"> tag',
    bullets: [
      { label: "BEST VALUE DEAL", text: "Bullet text with <style>body{}</style>" },
      { label: "Design details", text: "Clean & sharp graphic" },
    ],
    guidance: ["Care tip 1"],
    closing: "Closing text",
    productSeoTitle: "Test SEO Title",
    productSeoDescription: "Test SEO Description",
  };

  const html = formatProductDescriptionHtml(draft);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<style>"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;style&gt;"));

  // Verify label canonicalization removes promotional hype
  assert.equal(canonicalizeBulletLabel("BEST VALUE DEAL"), "Details");
  assert.equal(canonicalizeBulletLabel("Design details:"), "Design");
});

test("Content Fitters: enforce strict SEO length limits without slicing words", () => {
  const longSeoTitle =
    "Vintage Black Cat Halloween T-Shirt | Spooky Retro Aesthetic Graphic Tee for Cat Lovers - Best Sale";
  const fittedTitle = fitSeoTitle(longSeoTitle, "vintage black cat halloween t-shirt", 70);

  assert.ok(fittedTitle.length <= 70, `Title length was ${fittedTitle.length}`);
  assert.ok(!fittedTitle.endsWith(" "));

  const longDesc =
    "Celebrate spooky season in effortless style with this vintage black cat Halloween t-shirt. Specially designed with vibrant retro artwork and durable materials, this shirt is sure to impress everyone at the party while providing day-long comfort. Explore our collection today!";
  const fittedDesc = fitSeoDescription(longDesc, 160);

  assert.ok(fittedDesc.length <= 160, `Desc length was ${fittedDesc.length}`);
  assert.ok(!fittedDesc.endsWith("  "));

  const longProductTitle =
    "Vintage Retro Black Cat Graphic T-Shirt Spooky Halloween Costume Apparel for Cat Owners Men and Women";
  const fittedProductTitle = fitProductTitle(longProductTitle, 80);
  assert.ok(fittedProductTitle.length <= 80);
});

test("Claim Guard: flags unsupported high-risk claims and personalization violations", () => {
  const baseFacts: ContentFactSheet = {
    originalTitle: "Casual Cotton T-Shirt",
    originalDescription: "Comfortable everyday tee with graphic print.",
    ocrTexts: ["MEOW"],
    entities: ["cat"],
    colors: ["black"],
    targetAudience: ["cat lovers"],
    occasions: ["casual"],
    useCases: ["daily wear"],
    personalizationSupported: false, // NOT supported
  };

  const violatingDraft: GeneratedContentDraft = {
    productTitle: "Personalized Genuine Leather Cat Tee",
    intro: "Crafted from genuine leather with waterproof coating. Add your name for free!",
    bullets: [
      { label: "Material", text: "100% cashmere with lifetime warranty" },
      { label: "Delivery", text: "Includes free shipping worldwide" },
    ],
    guidance: [],
    closing: "Order your custom name shirt today.",
    productSeoTitle: "Personalized Genuine Leather Cat Tee",
    productSeoDescription: "Shop this waterproof tee with free shipping.",
  };

  const violations = checkClaimGrounding(violatingDraft, baseFacts);
  assert.ok(violations.length >= 4, `Expected at least 4 violations, got ${violations.length}`);
  assert.ok(violations.some((v) => v.includes("genuine leather")));
  assert.ok(violations.some((v) => v.includes("waterproof")));
  assert.ok(violations.some((v) => v.includes("free shipping")));
  assert.ok(violations.some((v) => v.includes("personalization")));

  // Supported claims pass cleanly
  const supportedFacts: ContentFactSheet = {
    ...baseFacts,
    originalTitle: "Personalized Genuine Leather Handbag",
    originalDescription: "Handcrafted genuine leather bag. Waterproof finish.",
    personalizationSupported: true,
  };

  const validDraft: GeneratedContentDraft = {
    productTitle: "Personalized Genuine Leather Handbag",
    intro: "Handcrafted genuine leather bag with waterproof protection.",
    bullets: [
      { label: "Material", text: "Genuine leather construction." },
      { label: "Personalization", text: "Custom initials available." },
    ],
    guidance: [],
    closing: "A timeless accessory.",
    productSeoTitle: "Personalized Genuine Leather Handbag",
    productSeoDescription: "Shop handcrafted waterproof leather handbag.",
  };

  const noViolations = checkClaimGrounding(validDraft, supportedFacts);
  assert.equal(noViolations.length, 0);
});
