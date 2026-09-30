import type { SeoContentInput } from "../../types";
import type { ContentGenerator } from "../content-generation/content-generation-types";
import type { ProductImageAnalyzer } from "../product-understanding/product-image-analyzer";
import type { ProviderRequestOptions } from "../provider-runtime";
import type { ShoppingContextAnalyzer } from "../shopping-context/shopping-context-analyzer";
import type { KeywordConflictAnalyzer } from "../conflict-control/keyword-conflict-analyzer";
import type { SeoConflictCorpus } from "../conflict-control/seo-conflict-corpus";
import { createDefaultProductImageAnalyzer } from "../stages/b1-product-understanding";
import { createDefaultShoppingContextAnalyzer } from "../stages/b2-shopping-context";
import { createDefaultB5Generator } from "../stages/b5-content-generation";
import { createDefaultKeywordConflictAnalyzer } from "../stages/b4-conflict-control";
import { summarizeVariants } from "../variant-summarizer";

export const DEFAULT_SEO_PROVIDER_ID = "gemini";
export const DEFAULT_SEO_PIPELINE_VERSION = "seo-b1-b6-v1";

export interface SeoProviderRuntime {
  readonly providerId: string;
  readonly model: string;
  readonly imageAnalyzer: ProductImageAnalyzer;
  readonly shoppingContextAnalyzer: ShoppingContextAnalyzer;
  readonly keywordConflictAnalyzer: KeywordConflictAnalyzer;
  readonly contentGenerator: ContentGenerator;
  /** Returns and clears the primary-provider failure observed before a fallback succeeded. */
  readonly consumePrimaryFailure?: (stage: "b1" | "b2" | "b5") => unknown;
}

export interface SeoProviderFactoryOptions {
  readonly imageMode: "full" | "alt_only";
  readonly requestOptions: ProviderRequestOptions;
  readonly onFallback: (stage: "b1" | "b2" | "b5", error: unknown) => void;
  readonly conflictCorpus?: SeoConflictCorpus;
}

export interface SeoProviderFactory {
  readonly providerId: string;
  create(options: SeoProviderFactoryOptions): SeoProviderRuntime;
}

export class SeoProviderRegistry {
  private readonly factories = new Map<string, SeoProviderFactory>();

  public register(factory: SeoProviderFactory): this {
    const providerId = normalizeProviderId(factory.providerId);
    if (!providerId) throw new Error("SEO providerId must not be empty.");
    if (this.factories.has(providerId)) {
      throw new Error(`SEO provider '${providerId}' is already registered.`);
    }
    this.factories.set(providerId, factory);
    return this;
  }

  public create(providerId: string, options: SeoProviderFactoryOptions): SeoProviderRuntime {
    const normalizedId = normalizeProviderId(providerId);
    const factory = this.factories.get(normalizedId);
    if (!factory) {
      throw new Error(`Unsupported SEO provider '${providerId}'. Registered providers: ${this.list().join(", ")}.`);
    }
    return factory.create(options);
  }

  public has(providerId: string): boolean {
    return this.factories.has(normalizeProviderId(providerId));
  }

  public list(): readonly string[] {
    return [...this.factories.keys()].sort();
  }
}

export function normalizeProviderId(providerId: string | undefined): string {
  return (providerId ?? DEFAULT_SEO_PROVIDER_ID).trim().toLowerCase();
}

/** Removes raw variants before the immutable pipeline/provider context is built. */
export function prepareSeoProviderInput(input: SeoContentInput): SeoContentInput {
  const { variants, ...providerSafeInput } = input;
  return Object.freeze({
    ...providerSafeInput,
    providerId: normalizeProviderId(input.providerId),
    pipelineVersion: input.pipelineVersion?.trim() || DEFAULT_SEO_PIPELINE_VERSION,
    variantSummary: input.variantSummary ?? summarizeVariants(variants),
  });
}

export function createGeminiSeoProviderFactory(): SeoProviderFactory {
  return {
    providerId: DEFAULT_SEO_PROVIDER_ID,
    create(options) {
      const env = typeof process !== "undefined" ? process.env : undefined;
      const model = env?.GEMINI_ANALYSIS_MODEL || env?.GEMINI_MODEL || "gemini-2.5-flash";
      const primaryFailures = new Map<"b1" | "b2" | "b5", unknown>();
      const observePrimaryFailure = (stage: "b1" | "b2" | "b5", error: unknown) => {
        primaryFailures.set(stage, error);
        options.onFallback(stage, error);
      };
      return {
        providerId: DEFAULT_SEO_PROVIDER_ID,
        model,
        imageAnalyzer: createDefaultProductImageAnalyzer({
          ...options.requestOptions,
          maxImages: options.imageMode === "alt_only" ? 1 : undefined,
          onFallback: (error) => observePrimaryFailure("b1", error),
        }),
        shoppingContextAnalyzer: createDefaultShoppingContextAnalyzer({
          ...options.requestOptions,
          onFallback: (error) => observePrimaryFailure("b2", error),
        }),
        keywordConflictAnalyzer: createDefaultKeywordConflictAnalyzer({
          requestOptions: options.requestOptions,
          conflictCorpus: options.conflictCorpus,
        }),
        contentGenerator: createDefaultB5Generator({
          ...options.requestOptions,
          onFallback: (reason, error) => observePrimaryFailure("b5", error ?? reason),
        }),
        consumePrimaryFailure(stage) {
          const error = primaryFailures.get(stage);
          primaryFailures.delete(stage);
          return error;
        },
      };
    },
  };
}

let defaultRegistry: SeoProviderRegistry | undefined;

export function getDefaultSeoProviderRegistry(): SeoProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new SeoProviderRegistry().register(createGeminiSeoProviderFactory());
  }
  return defaultRegistry;
}
