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
          ocrTexts: ["Song Title", "Artist"],
          detectedEntities: ["music player", "rug"],
          dominantColors: ["black", "warm beige"],
          visualStyle: "modern minimalist",
          productCategory: "area rug",
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
  assert.match(report, /custom music rug/);
  assert.match(report, /SEO preview/);
  assert.match(report, /music-rug-1\.webp/);
  assert.ok(report.indexOf("music-rug-1.webp") < report.indexOf("music-rug-2.webp"));
});

test("renders the product description through a restrictive safe HTML allowlist", () => {
  const report = renderSmokeReport(summary, new Map());

  assert.match(report, /<p>Make it yours\.<\/p>/);
  assert.match(report, /<strong>Custom<\/strong>/);
  assert.match(report, /&#39;Song Title&#39;/);
  assert.doesNotMatch(report, /<script>/);
  assert.match(report, /&lt;script&gt;alert/);
});
