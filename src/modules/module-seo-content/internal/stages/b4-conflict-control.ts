import { evolveContext } from "../pipeline-context";
import {
  DefaultKeywordConflictAnalyzer,
  type KeywordConflictAnalyzer,
} from "../conflict-control/keyword-conflict-analyzer";
import { VertexTextEmbeddingProvider } from "../conflict-control/vertex-text-embedding-provider";
import { LocalTfidfVectorizer } from "../conflict-control/local-tfidf-vectorizer";

import type {
  ConflictResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export interface B4ConflictControlDependencies {
  readonly analyzer?: KeywordConflictAnalyzer;
  readonly conflictAnalyzer?: KeywordConflictAnalyzer;
}

/**
 * Creates default keyword conflict analyzer based on runtime configuration.
 *
 * Environment switches:
 * - SEO_EMBEDDING_PROVIDER: "vertex" | "local" | "fallback"
 * - GOOGLE_CLOUD_PROJECT: Google Cloud Project ID for Vertex AI Application Default Credentials (ADC)
 * - SEO_EMBEDDING_MODEL: "text-embedding-004" (default) or "text-embedding-005"
 *
 * Determinism guard:
 * When running under automated test runner (NODE_ENV === "test" or process argv includes .test.ts),
 * defaults safely to LocalTfidfVectorizer to ensure zero network calls unless SEO_EMBEDDING_PROVIDER="vertex"
 * is explicitly configured.
 */
export function createDefaultKeywordConflictAnalyzer(): KeywordConflictAnalyzer {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;
  const configuredProvider = env?.SEO_EMBEDDING_PROVIDER?.toLowerCase();

  const isTestRunner =
    typeof process !== "undefined" &&
    ((process.execArgv && process.execArgv.includes("--test")) ||
      (process.argv &&
        process.argv.some(
          (arg) =>
            arg === "--test" ||
            arg.endsWith(".test.ts") ||
            arg.endsWith(".test.js") ||
            arg.endsWith(".test.mjs"),
        )));

  const isTestEnvironment = env?.NODE_ENV === "test" || isTestRunner;

  // If explicitly local/fallback or in test environment without explicit vertex override
  if (
    configuredProvider === "local" ||
    configuredProvider === "fallback" ||
    (isTestEnvironment && configuredProvider !== "vertex")
  ) {
    return new DefaultKeywordConflictAnalyzer({
      fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
    });
  }

  // Live production/development mode with Vertex AI
  if (projectId) {
    const location = env?.GOOGLE_CLOUD_LOCATION || "global";
    const model = env?.SEO_EMBEDDING_MODEL || "text-embedding-004";

    const vertexProvider = new VertexTextEmbeddingProvider({
      projectId,
      location,
      defaultModel: model,
    });

    return new DefaultKeywordConflictAnalyzer({
      primaryEmbeddingProvider: vertexProvider,
      fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
    });
  }

  // Default fallback if no Google Cloud Project is configured
  return new DefaultKeywordConflictAnalyzer({
    fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
  });
}

export function createB4ConflictControlStage(
  dependencies?: B4ConflictControlDependencies,
): SeoPipelineStage {
  const analyzer =
    dependencies?.analyzer ??
    dependencies?.conflictAnalyzer ??
    createDefaultKeywordConflictAnalyzer();

  return {
    name: "b4",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const conflictResult: ConflictResult = await analyzer.analyze({
        searchResearch: context.searchResearch,
        productUnderstanding: context.productUnderstanding,
        shoppingContext: context.shoppingContext,
        source: context.source,
      });

      return evolveContext(context, { conflictResult });
    },
  };
}

export const b4ConflictControlStage: SeoPipelineStage =
  createB4ConflictControlStage();

export async function executeB4ConflictControl(
  context: SeoPipelineContext,
  dependencies?: B4ConflictControlDependencies,
): Promise<SeoPipelineContext> {
  const stage = createB4ConflictControlStage(dependencies);
  return stage.execute(context);
}
