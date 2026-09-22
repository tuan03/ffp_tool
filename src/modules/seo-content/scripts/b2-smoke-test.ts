import type { SeoContentInput } from "../types";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import { createB2ShoppingContextStage } from "../internal/stages/b2-shopping-context";

/**
 * Standalone Node.js smoke test for B2 Shopping Context.
 * Demonstrates running B2 in a trusted Node.js runtime with real Gemini Vertex AI integration or fallback.
 *
 * Usage:
 *   npx tsx src/modules/seo-content/scripts/b2-smoke-test.ts
 */
async function main(): Promise<void> {
  console.log("=== [B2 Shopping Context] Node.js Smoke Test ===");
  console.log("Environment:");
  console.log(`  GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT ?? "(not set)"}`);
  console.log(`  GOOGLE_CLOUD_LOCATION: ${process.env.GOOGLE_CLOUD_LOCATION ?? "global"}`);
  console.log(`  GEMINI_ANALYSIS_MODEL: ${process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-2.5-flash"}`);

  const sampleInput: SeoContentInput = {
    title: "Vintage Halloween Black Cat T-Shirt",
    description: "Soft cotton t-shirt with vintage black cat graphic for spooky season.",
    niche: "halloween",
    handle: "vintage-halloween-black-cat-t-shirt",
    images: [],
  };

  const initialContext = createInitialContext(sampleInput);
  const contextWithB1 = evolveContext(initialContext, {
    productUnderstanding: {
      ocrTexts: ["TRICK OR TREAT"],
      detectedEntities: ["black cat", "pumpkin"],
      dominantColors: ["black", "orange"],
      visualStyle: "vintage retro",
      productCategory: "t-shirt",
    },
  });

  const stage = createB2ShoppingContextStage();

  console.log("\nExecuting B2 Stage...");
  const resultContext = await stage.execute(contextWithB1);

  console.log("\n=== Result Context Shopping Context ===");
  console.log(JSON.stringify(resultContext.shoppingContext, null, 2));
}

main().catch((err) => {
  console.error("B2 Smoke test encountered an error:", err);
  process.exit(1);
});
