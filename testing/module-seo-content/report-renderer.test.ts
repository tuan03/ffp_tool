import assert from "node:assert/strict";
import test from "node:test";

import { renderSmokeReport } from "./report-renderer";

const summary = {
  startedAt: "2026-09-23T09:30:47.789Z",
  completedAt: "2026-09-23T09:31:13.001Z",
  durationMs: 25212,
  input: {
    title: "Personalized Music Player Area Rug",
    niche: "personalized rug",
    imageCount: 2,
  },
  environment: { googleCloudProject: "test-project" },
  stageTraces: [
    {
      stageName: "b1" as const,
      effectiveNiche: "personalized music rugs",
      summary: {
        productUnderstanding: {
          typography: { visibleTexts: ["Song Title", "Artist"], styleSummary: "white media-player labels" },
          visualEntities: "Media player interface with a cloud-head portrait.",
          sceneContext: "Home studio with guitars and monitor speakers.",
          physicalProductIdentity: "area rug",
        },
      },
    },
    {
      stageName: "b2" as const,
      summary: {
        shoppingContext: {
          targetAudience: ["music lovers"],
          suitableOccasions: ["gifting"],
          useCases: ["personal decor"],
          buyerIntentKeywords: ["personalized music rug"],
          contextualAudienceHints: ["home studio decorators"],
          sceneSearchSeeds: ["home studio area rug"],
        },
      },
    },
    {
      stageName: "b3" as const,
      summary: {
        searchResearch: {
          seedKeywords: ["music player rug"],
          suggestedQueries: ["custom music rug", "music decor rug"],
          querySources: { "custom music rug": "google_autocomplete" },
        },
      },
    },
    {
      stageName: "b4" as const,
      summary: {
        conflictResult: {
          approvedKeywords: ["personalized music rug"],
          discardedKeywords: ["home studio area rug"],
          conflictReasons: { "home studio area rug": "scene_context_only" },
        },
      },
    },
    {
      stageName: "b5" as const,
      summary: {
        contentResult: {
          productTitle: "Music Rug",
          productDescription: "<p>Make it yours.</p><ul><li><strong>Custom</strong> &#39;Song Title&#39;</li></ul><script>alert('no')</script>",
          productSeoTitle: "Music Rug | Shop",
          productSeoDescription: "A personalized music player rug.",
          productHandle: "music-rug",
        },
        contentGenerationMetadata: { primaryKeyword: "music player rug", secondaryKeywords: ["custom rug"] },
      },
    },
    {
      stageName: "b6" as const,
      summary: {
        imageResult: {
          processedImages: [
            { sourceUrl: "first.webp", alt: "First image", webp: { filename: "music-rug-1.webp" } },
            { sourceUrl: "second.webp", alt: "Second image", webp: { filename: "music-rug-2.webp" } },
          ],
        },
        imageProcessingMetadata: {
          totalImages: 2,
          convertedImages: 1,
          failedConversions: 1,
          converter: "sharp",
          issues: [{ imageIndex: 1, code: "conversion_failed", message: "Sharp library is not available" }],
        },
      },
    },
  ],
  output: {
    productTitle: "Music Rug",
    productDescription: "<p>Make it yours.</p>",
    productSeoTitle: "Music Rug | Shop",
    productSeoDescription: "A personalized music player rug.",
    productHandle: "music-rug",
    images: [
      { sourceUrl: "first.webp", alt: "First image", webp: { filename: "music-rug-1.webp" } },
      { sourceUrl: "second.webp", alt: "Second image", webp: { filename: "music-rug-2.webp" } },
    ],
  },
};

test("renders stage summaries as scannable cards instead of raw JSON", () => {
  const report = renderSmokeReport(summary, new Map());

  assert.doesNotMatch(report, /<pre>/);
  assert.doesNotMatch(report, /"productUnderstanding"/);
  assert.match(report, /Vision & product understanding/);
  assert.match(report, /Song Title/);
  assert.match(report, /Định danh phôi sản phẩm/);
  assert.doesNotMatch(report, /Dominant colours|Product category|Visual style/);
  assert.match(report, /custom music rug/);
  assert.match(report, /SEO preview/);
  assert.match(report, /music-rug-1\.webp/);
  assert.ok(report.indexOf("music-rug-1.webp") < report.indexOf("music-rug-2.webp"));
});

test("renders product-safe provenance and image conversion states without treating scene data as copy facts", () => {
  const report = renderSmokeReport(summary, new Map([["music-rug-1.webp", "images/music-rug-1.webp"]]));

  assert.match(report, /Bằng chứng sản phẩm an toàn cho copy/);
  assert.match(report, /Scene context is discovery-only/);
  assert.match(report, /Contextual discovery only/);
  assert.match(report, /Scene-only context · blocked/);
  assert.match(report, /Converted WebP/);
  assert.match(report, /Source WebP fallback/);
  assert.doesNotMatch(report, /sceneContext.*Safe evidence/s);
});

test("renders the product description through a restrictive safe HTML allowlist", () => {
  const report = renderSmokeReport(summary, new Map());

  assert.match(report, /<p>Make it yours\.<\/p>/);
  assert.match(report, /<strong>Custom<\/strong>/);
  assert.match(report, /&#39;Song Title&#39;/);
  assert.doesNotMatch(report, /<script>/);
  assert.match(report, /&lt;script&gt;alert/);
});
