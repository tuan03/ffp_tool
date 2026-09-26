import { evolveContext } from "../pipeline-context";
import type {
  ContentGenerationMetadata,
  ContentResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import { buildContentFactSheet } from "../content-generation/content-fact-sheet";
import { allocateKeywords } from "../content-generation/keyword-allocator";
import { formatProductDescriptionHtml } from "../content-generation/html-description-formatter";
import { generateProductHandle } from "../content-generation/slug-utils";
import {
  fitProductTitle,
  fitSeoDescription,
  fitSeoTitle,
} from "../content-generation/content-fitters";
import { validateFinalContent } from "../content-generation/content-result-validator";
import { HeuristicContentGenerator } from "../content-generation/heuristic-content-generator";
import { GeminiSeoContentGenerator } from "../content-generation/gemini-content-generator";
import { FallbackContentGenerator } from "../content-generation/fallback-content-generator";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";
import { buildBeddingSeoDescription } from "../content-generation/heuristic-content-generator";
import { extractVisionDesignConcept } from "../content-generation/heuristic-title-builder";
import { sanitizeBeddingTitle } from "../store-profiles";
import type {
  ContentConstraints,
  ContentGenerator,
} from "../content-generation/content-generation-types";

export interface B5ContentGenerationOptions {
  readonly generator?: ContentGenerator;
  readonly constraints?: Partial<ContentConstraints>;
}

const DEFAULT_CONSTRAINTS: ContentConstraints = {
  maxSeoTitleLength: 70,
  maxSeoDescriptionLength: 160,
  maxHandleLength: 80,
  maxBullets: 5,
  preserveExistingHandle: true,
};

export function createDefaultB5Generator(options?: {
  readonly onFallback?: (reason: string, error?: unknown) => void;
}): FallbackContentGenerator | HeuristicContentGenerator {
  const heuristic = new HeuristicContentGenerator();
  const projectId =
    typeof process !== "undefined" && process.env
      ? process.env.GOOGLE_CLOUD_PROJECT
      : undefined;

  if (projectId) {
    try {
      const configuredMaxOutputTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 2048);
      const maxOutputTokens = Number.isFinite(configuredMaxOutputTokens)
        ? Math.max(512, Math.min(8192, Math.trunc(configuredMaxOutputTokens)))
        : 2048;
      const vertexSdk = new GoogleGenAIVertexContentGenerator({
        projectId,
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
        defaultModel:
          process.env.GEMINI_ANALYSIS_MODEL
          || process.env.GEMINI_MODEL
          || "gemini-2.5-flash",
      });
      const geminiGenerator = new GeminiSeoContentGenerator(vertexSdk, { maxOutputTokens });
      return new FallbackContentGenerator(geminiGenerator, heuristic, options?.onFallback);
    } catch {
      return heuristic;
    }
  }

  return heuristic;
}

export async function executeB5ContentGeneration(
  context: SeoPipelineContext,
  options: B5ContentGenerationOptions = {},
): Promise<SeoPipelineContext> {
  const constraints: ContentConstraints = {
    ...DEFAULT_CONSTRAINTS,
    ...options.constraints,
  };

  // 1. Build verified fact sheet from context
  const facts = buildContentFactSheet(context);

  // 2. Allocate keywords into primary, secondary, and supporting tiers
  const keywords = allocateKeywords({
    approvedKeywords: context.conflictResult?.approvedKeywords ?? [],
    discardedKeywords: context.conflictResult?.discardedKeywords ?? [],
    relevanceScores: context.conflictResult?.relevanceScores,
    keywordClusters: context.conflictResult?.keywordClusters,
    productCategory: facts.physicalProductIdentity,
    framingSources: {
      targetAudience: facts.targetAudience,
      suitableOccasions: facts.occasions,
      useCases: facts.useCases,
    },
  });

  // 3. Obtain content generator
  const activeGenerator = options.generator ?? createDefaultB5Generator();

  // 4. Generate draft content
  let draft;
  let generatorOrigin: "gemini" | "heuristic" = "heuristic";

  if (activeGenerator instanceof FallbackContentGenerator) {
    const res = await activeGenerator.generateWithOrigin({
      facts,
      keywords,
      constraints,
    });
    draft = res.draft;
    generatorOrigin = res.generator;
  } else {
    draft = await activeGenerator.generate({
      facts,
      keywords,
      constraints,
    });
    generatorOrigin = activeGenerator instanceof GeminiSeoContentGenerator ? "gemini" : "heuristic";
  }

  // 5. Finalize, fit, and format content fields
  if (facts.storeProfile?.bedding && (!draft.styleOptions || draft.styleOptions.length < 3)) {
    draft = {
      ...draft,
      styleOptions: facts.storeProfile.bedding.options.map((opt) => ({
        name: opt.name,
        description: `${opt.shortDescription}. ${opt.detailedFeatures}`,
      })),
    };
  }

  let productTitle = fitProductTitle(draft.productTitle, 80);
  let productSeoTitle = fitSeoTitle(
    draft.productSeoTitle,
    keywords.primary,
    constraints.maxSeoTitleLength,
  );

  let productSeoDescription: string;
  if (facts.storeProfile?.bedding) {
    productTitle = sanitizeBeddingTitle(productTitle);
    productSeoTitle = sanitizeBeddingTitle(productSeoTitle);

    const hasAllKeywords =
      draft.productSeoDescription.includes("Comforter") &&
      draft.productSeoDescription.includes("Quilt") &&
      draft.productSeoDescription.includes("Duvet Cover") &&
      draft.productSeoDescription.length >= 155 &&
      draft.productSeoDescription.length <= constraints.maxSeoDescriptionLength;

    if (hasAllKeywords) {
      productSeoDescription = draft.productSeoDescription;
    } else {
      productSeoDescription = buildBeddingSeoDescription(
        productTitle,
        extractVisionDesignConcept(facts),
        constraints.maxSeoDescriptionLength,
      );
    }
  } else {
    productSeoDescription = fitSeoDescription(
      draft.productSeoDescription,
      constraints.maxSeoDescriptionLength,
    );
  }

  const productDescription = formatProductDescriptionHtml(draft);
  const productHandle = generateProductHandle(keywords.primary || productTitle, {
    existingHandle: facts.existingHandle,
    preserveExisting: constraints.preserveExistingHandle,
    maxLength: constraints.maxHandleLength,
  });

  const contentResult: ContentResult = {
    productTitle,
    productDescription,
    productSeoTitle,
    productSeoDescription,
    productHandle,
    aeo_quick_summary: draft.aeo_quick_summary,
    aeo_faq: draft.aeo_faq,
    aeo_json_ld: draft.aeo_json_ld,
  };

  // 6. Validate final content
  validateFinalContent(contentResult, draft, facts, keywords, constraints);

  // 7. Assemble metadata
  const contentGenerationMetadata: ContentGenerationMetadata = {
    primaryKeyword: keywords.primary,
    secondaryKeywords: keywords.secondary,
    supportingKeywords: keywords.supportingKeywords,
    targetedKeywords: keywords.targetedKeywords,
    generator: generatorOrigin,
    corpusRevision: context.conflictResult?.corpusRevision,
  };

  return evolveContext(context, {
    contentResult,
    contentGenerationMetadata,
  });
}

export const b5ContentGenerationStage: SeoPipelineStage = {
  name: "b5",
  execute: executeB5ContentGeneration,
};

export function createB5ContentGenerationStage(
  options: B5ContentGenerationOptions = {},
): SeoPipelineStage {
  return {
    name: "b5",
    execute: (context) => executeB5ContentGeneration(context, options),
  };
}
