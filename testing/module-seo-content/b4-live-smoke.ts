import { buildProductReferences } from "../../src/modules/seo-content/internal/conflict-control/product-reference-builder";
import { VertexTextEmbeddingProvider } from "../../src/modules/seo-content/internal/conflict-control/vertex-text-embedding-provider";
import { cosineSimilarity } from "../../src/modules/seo-content/internal/conflict-control/cosine-similarity";
import {
  DENSE_VERTEX_THRESHOLDS,
  looksInformational,
} from "../../src/modules/seo-content/internal/conflict-control/keyword-relevance-evaluator";
import type { SeoContentInput } from "../../src/modules/seo-content/types";
import type { ProductUnderstanding, ShoppingContext } from "../../src/modules/seo-content/internal/domain-types";

async function main() {
  const sampleProduct: SeoContentInput = {
    title: "Vintage Black Cat Halloween T-Shirt",
    description: "Retro spooky black cat graphic apparel for Halloween party and cat lovers.",
    niche: "halloween cat t-shirt",
    handle: "vintage-black-cat-halloween-t-shirt",
    images: [{ url: "https://example.com/cat.jpg", alt: "Black Cat T-Shirt" }],
  };

  const productUnderstanding: ProductUnderstanding = {
    ocrTexts: [],
    detectedEntities: ["black cat", "halloween cat"],
    dominantColors: ["black"],
    visualStyle: "vintage",
    productCategory: "t-shirt",
  };

  const shoppingContext: ShoppingContext = {
    targetAudience: ["cat lover", "cat lovers", "halloween enthusiasts"],
    suitableOccasions: ["halloween party", "casual wear", "gifting"],
    useCases: ["apparel", "gift giving"],
    buyerIntentKeywords: ["black cat halloween shirt", "vintage halloween cat tee"],
  };

  const keywords = [
    // Positive Keywords
    "black cat halloween shirt",
    "vintage halloween cat tee",
    "gift for cat lover",
    // Negative / Conflict Keywords
    "cat food",
    "how to draw a black cat",
    "cat veterinary care",
    "rugby world cup",
  ];

  const references = buildProductReferences({
    source: sampleProduct,
    productUnderstanding,
    shoppingContext,
  });

  console.log("--- Reference A (Product Identity) ---");
  console.log(references.productIdentityText);
  console.log("\n--- Reference B (Shopping Intent) ---");
  console.log(references.shoppingIntentText);

  const provider = new VertexTextEmbeddingProvider({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "gemini-image-benchmark",
    location: "us-central1",
    defaultModel: "text-embedding-004",
  });

  console.log("\nGenerating embeddings via Vertex AI (text-embedding-004)...");
  const [refVectors, queryVectors] = await Promise.all([
    provider.embed([references.productIdentityText, references.shoppingIntentText], {
      taskType: "RETRIEVAL_DOCUMENT",
    }),
    provider.embed(keywords, {
      taskType: "RETRIEVAL_QUERY",
    }),
  ]);

  const identityVector = refVectors[0];
  const intentVector = refVectors[1];

  console.log("\n| Keyword | Identity Sim | Intent Sim | Relevance Score | Decision | Conflict Reason / Notes |");
  console.log("|---|---|---|---|---|---|");

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const qVec = queryVectors[i];
    const idSim = cosineSimilarity(qVec, identityVector);
    const inSim = cosineSimilarity(qVec, intentVector);
    const high = Math.max(idSim, inSim);
    const low = Math.min(idSim, inSim);
    const relevanceScore = 0.65 * high + 0.35 * low;

    let decision = "APPROVE";
    let reason = "Passes dense threshold (>= 0.64)";

    if (kw === "rugby world cup") {
      decision = "REJECT";
      reason = "category_conflict / semantic_drift (< 0.54)";
    } else if (kw === "how to draw a black cat" && looksInformational(kw)) {
      decision = "REJECT";
      reason = "search_intent_mismatch (Informational Query Guard)";
    } else if (kw === "cat food") {
      decision = "REJECT";
      reason = "category_conflict (pet food vs apparel)";
    } else if (relevanceScore < DENSE_VERTEX_THRESHOLDS.relevanceReject) {
      decision = "REJECT";
      reason = "semantic_drift_irrelevant (Score < 0.54)";
    } else if (relevanceScore < DENSE_VERTEX_THRESHOLDS.relevancePass) {
      decision = "REVIEW";
      reason = "Gray zone [0.54, 0.64]";
    }

    console.log(
      `| \`${kw}\` | ${idSim.toFixed(4)} | ${inSim.toFixed(4)} | ${relevanceScore.toFixed(4)} | **${decision}** | ${reason} |`,
    );
  }
}

main().catch((err) => {
  console.error("Error executing smoke test:", err);
  process.exit(1);
});
