import type { SeoContentInput } from "../../src/modules/seo-content/types";
import { createInitialContext, evolveContext } from "../../src/modules/seo-content/internal/pipeline-context";
import { GoogleSearchSuggestionsCollector } from "../../src/modules/seo-content/internal/search-suggestions/google-search-suggestions-collector";
import { UnofficialGoogleSuggestClient } from "../../src/modules/seo-content/internal/search-suggestions/google-suggest-client";
import { createB3SearchSuggestionsStage } from "../../src/modules/seo-content/internal/stages/b3-search-suggestions";

/**
 * Standalone Node.js live smoke test for B3 Search Suggestions.
 * Demonstrates real live Google Autocomplete search query expansion with provenance.
 *
 * Usage:
 *   npx tsx src/modules/seo-content/scripts/b3-smoke-test.ts
 */
async function main(): Promise<void> {
  console.log("=== [B3 Search Suggestions] Node.js Smoke Test ===");
  console.log("Environment:");
  console.log(`  SEO_SEARCH_LANGUAGE: ${process.env.SEO_SEARCH_LANGUAGE ?? "en (default)"}`);
  console.log(`  SEO_SEARCH_COUNTRY: ${process.env.SEO_SEARCH_COUNTRY ?? "us (default)"}`);

  const sampleInput: SeoContentInput = {
    title: "Vintage Halloween Black Cat T-Shirt",
    description: "Soft cotton t-shirt with vintage black cat graphic for spooky season.",
    niche: "halloween",
    handle: "vintage-halloween-black-cat-t-shirt",
    images: [],
  };

  const initialContext = createInitialContext(sampleInput);
  const contextWithB1AndB2 = evolveContext(initialContext, {
    productUnderstanding: {
      typography: { visibleTexts: ["TRICK OR TREAT"], styleSummary: "vintage retro lettering" },
      visualEntities: "Black cat and pumpkin graphic.",
      sceneContext: "Unknown",
      physicalProductIdentity: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers", "vintage aesthetic enthusiasts"],
      suitableOccasions: ["halloween celebration", "everyday wear"],
      useCases: ["casual street wear", "costume party wear"],
      buyerIntentKeywords: [
        "vintage black cat t-shirt",
        "black cat halloween t-shirt",
        "halloween t-shirt",
        "gift for cat lover",
      ],
    },
  });

  const client = new UnofficialGoogleSuggestClient();
  const collector = new GoogleSearchSuggestionsCollector({
    client,
    interRequestDelayMs: 250,
  });

  const stage = createB3SearchSuggestionsStage({ collector });

  console.log("\nExecuting B3 Stage against live Google Autocomplete endpoint...");
  const startTime = Date.now();
  const resultContext = await stage.execute(contextWithB1AndB2);
  const duration = Date.now() - startTime;

  console.log(`\nCompleted in ${duration}ms.`);
  console.log("\n=== Result SearchResearchResult ===");
  console.log("Seeds selected for research:", resultContext.searchResearch?.seedKeywords);
  console.log(`Suggested queries count: ${resultContext.searchResearch?.suggestedQueries.length}`);
  console.log("Sample suggested queries (first 10):", resultContext.searchResearch?.suggestedQueries.slice(0, 10));
  console.log("Query sources provenance mapping (sample):");
  const sources = resultContext.searchResearch?.querySources ?? {};
  const entries = Object.entries(sources).slice(0, 10);
  for (const [query, source] of entries) {
    console.log(`  "${query}" => [${source}]`);
  }
}

main().catch((err) => {
  console.error("B3 Smoke test encountered an error:", err);
  process.exit(1);
});
