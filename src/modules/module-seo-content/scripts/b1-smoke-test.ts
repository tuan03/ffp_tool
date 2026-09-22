import { createDefaultProductImageAnalyzer } from "../internal/stages/b1-product-understanding";
import type { SeoContentInput } from "../types";
import { createInitialContext } from "../internal/pipeline-context";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";

/**
 * Standalone Node.js smoke test for B1 Product Understanding.
 * Demonstrates running B1 in a trusted Node.js runtime with real Gemini Vertex AI integration.
 *
 * Usage:
 *   npx tsx src/modules/module-seo-content/scripts/b1-smoke-test.ts [image_path_or_url]
 */
async function main(): Promise<void> {
  console.log("=== [B1 Product Understanding] Node.js Smoke Test ===");
  console.log("Environment:");
  console.log(`  GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT ?? "(not set)"}`);
  console.log(`  GOOGLE_CLOUD_LOCATION: ${process.env.GOOGLE_CLOUD_LOCATION ?? "global"}`);
  console.log(`  GEMINI_ANALYSIS_MODEL: ${process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-2.5-flash"}`);

  const targetImage = process.argv[2] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=60";
  console.log(`Target Image: ${targetImage}`);

  const sampleInput: SeoContentInput = {
    title: "Vintage Halloween Black Cat T-Shirt",
    description: "Soft cotton t-shirt with vintage black cat graphic and retro text.",
    niche: "halloween",
    handle: "vintage-halloween-black-cat-t-shirt",
    images: [
      {
        url: targetImage,
        alt: "Vintage Halloween Black Cat T-Shirt",
      },
    ],
  };

  const analyzer = createDefaultProductImageAnalyzer();
  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: analyzer });

  console.log("\nExecuting B1 Stage...");
  const initialContext = createInitialContext(sampleInput);
  const resultContext = await stage.execute(initialContext);

  console.log("\n=== Result Context Product Understanding ===");
  console.log(JSON.stringify(resultContext.productUnderstanding, null, 2));
}

main().catch((err) => {
  console.error("Smoke test encountered an error:", err);
  process.exit(1);
});
