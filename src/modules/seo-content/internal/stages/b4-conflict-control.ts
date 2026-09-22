import { evolveContext } from "../pipeline-context";
import {
  DefaultKeywordConflictAnalyzer,
  type KeywordConflictAnalyzer,
} from "../conflict-control/keyword-conflict-analyzer";
import { VertexTextEmbeddingProvider } from "../conflict-control/vertex-text-embedding-provider";
import { LocalTfidfVectorizer } from "../conflict-control/local-tfidf-vectorizer";
import { FileSeoConflictCorpus } from "../conflict-control/file-seo-conflict-corpus";
import { EmptySeoConflictCorpus } from "../conflict-control/empty-seo-conflict-corpus";
import type {
  SeoConflictCorpus,
  SeoProductIdentity,
  StoredEmbedding,
} from "../conflict-control/seo-conflict-corpus";
import {
  CorpusRevisionConflictError,
  CorpusLockTimeoutError,
  SeoConflictCorpusCorruptError,
} from "../conflict-control/corpus-errors";

import type {
  ConflictResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type { SeoContentInput } from "../../types";

export interface B4ConflictControlDependencies {
  readonly analyzer?: KeywordConflictAnalyzer;
  readonly conflictAnalyzer?: KeywordConflictAnalyzer;
  readonly conflictCorpus?: SeoConflictCorpus;
}

/**
 * Creates default keyword conflict analyzer based on runtime configuration.
 *
 * Environment switches:
 * - SEO_EMBEDDING_PROVIDER: "vertex" | "local" | "fallback"
 * - GOOGLE_CLOUD_PROJECT: Google Cloud Project ID for Vertex AI Application Default Credentials (ADC)
 * - SEO_EMBEDDING_MODEL: "text-embedding-004" (default) or "text-embedding-005"
 * - SEO_CONFLICT_CORPUS_PATH: File path for store catalog conflict database
 *
 * Determinism guard:
 * When running under automated test runner (NODE_ENV === "test" or process argv includes .test.ts),
 * defaults safely to LocalTfidfVectorizer and EmptySeoConflictCorpus to ensure zero network calls
 * unless SEO_EMBEDDING_PROVIDER="vertex" or an explicit corpus is configured.
 */
export function createDefaultKeywordConflictAnalyzer(
  dependencies?: B4ConflictControlDependencies,
): KeywordConflictAnalyzer {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;
  const configuredProvider = env?.SEO_EMBEDDING_PROVIDER?.toLowerCase();
  const corpusPath = env?.SEO_CONFLICT_CORPUS_PATH;

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

  const isBrowser =
    typeof window !== "undefined" && typeof window.document !== "undefined";

  const isTestEnvironment = env?.NODE_ENV === "test" || isTestRunner;

  // Resolve conflict corpus: injected dependency -> configured file path -> empty corpus
  const conflictCorpus: SeoConflictCorpus =
    dependencies?.conflictCorpus ??
    (isBrowser
      ? new EmptySeoConflictCorpus()
      : corpusPath
        ? new FileSeoConflictCorpus({ filePath: corpusPath })
        : isTestEnvironment
          ? new EmptySeoConflictCorpus()
          : new FileSeoConflictCorpus());

  // If explicitly local/fallback or in test environment without explicit vertex override
  if (
    configuredProvider === "local" ||
    configuredProvider === "fallback" ||
    (isTestEnvironment && configuredProvider !== "vertex")
  ) {
    return new DefaultKeywordConflictAnalyzer({
      fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
      conflictCorpus,
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
      conflictCorpus,
    });
  }

  // Default fallback if no Google Cloud Project is configured
  return new DefaultKeywordConflictAnalyzer({
    fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
    conflictCorpus,
  });
}

export function createB4ConflictControlStage(
  dependencies?: B4ConflictControlDependencies,
): SeoPipelineStage {
  const analyzer =
    dependencies?.analyzer ??
    dependencies?.conflictAnalyzer ??
    createDefaultKeywordConflictAnalyzer(dependencies);

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

export const b4ConflictControlStage: SeoPipelineStage = {
  name: "b4",
  async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
    return executeB4ConflictControl(context);
  },
};

export async function executeB4ConflictControl(
  context: SeoPipelineContext,
  dependencies?: B4ConflictControlDependencies,
): Promise<SeoPipelineContext> {
  const stage = createB4ConflictControlStage(dependencies);
  return stage.execute(context);
}

export interface RegisterProductKeywordsOptions {
  readonly title?: string;
  readonly expectedRevision?: number;
  readonly embeddings?: Readonly<Record<string, StoredEmbedding>>;
  readonly conflictResult?: ConflictResult;
}

/**
 * Convenience helper to register approved keywords of a product into the catalog database.
 * Call this upon successful completion of the SEO pipeline (e.g. after B5/B6) to claim keywords.
 */
export async function registerProductKeywords(
  corpus: SeoConflictCorpus,
  product: SeoContentInput,
  approvedKeywords: readonly string[],
  options?: RegisterProductKeywordsOptions,
): Promise<{ revision: number }> {
  if (!corpus.upsertProduct) {
    return { revision: 0 };
  }

  const identity: SeoProductIdentity = {
    productId: product.productId,
    handle: product.handle,
    url: product.url ?? (product.handle ? `/products/${product.handle}` : undefined),
  };

  const embeddingsMap =
    options?.embeddings ?? options?.conflictResult?.approvedEmbeddings;
  const expectedRevision =
    options?.expectedRevision ?? options?.conflictResult?.corpusRevision;

  const registeredKeywords = approvedKeywords.map((kw, rank) => ({
    keyword: kw,
    rank,
    embedding: embeddingsMap?.[kw],
  }));

  return corpus.upsertProduct({
    identity,
    title: options?.title ?? product.title,
    approvedKeywords: registeredKeywords,
    expectedRevision,
  });
}

export {
  CorpusRevisionConflictError,
  SeoConflictCorpusCorruptError,
  CorpusLockTimeoutError,
} from "../conflict-control/corpus-errors";

/**
 * Convenience helper to execute an action with retry on optimistic revision conflict.
 * If another worker commits to the catalog corpus concurrently between B4 and final commit,
 * the action is retried with the fresh corpus state.
 */
export async function retryOnCorpusRevisionConflict<T>(
  action: (attempt: number) => Promise<T>,
  options?: {
    readonly maxRetries?: number;
    readonly onRetry?: (attempt: number, error: CorpusRevisionConflictError) => void;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    try {
      return await action(attempt);
    } catch (err) {
      if (err instanceof CorpusRevisionConflictError && attempt < maxRetries) {
        attempt++;
        options?.onRetry?.(attempt, err);
        continue;
      }
      throw err;
    }
  }
}

