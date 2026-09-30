import { createHash } from "node:crypto";

import type { SeoContentInput } from "../../types";
import { summarizeVariants } from "../variant-summarizer";

interface CanonicalImageFingerprint {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly localFilePath: string;
  readonly contentFingerprint: string;
}

export interface CanonicalProductIdentity {
  readonly storeId: string;
  readonly siteDomain: string;
  readonly productId: string;
  readonly sourceUrl: string;
  readonly sourceVersion: string;
  readonly shopifyUpdatedAt: string;
  readonly providerId: string;
  readonly pipelineVersion: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly niche: string;
  readonly variantLabel: string;
  readonly variantSummary: ReturnType<typeof summarizeVariants>;
  readonly existingPrimaryKeyword: string;
  readonly existingKeywords: readonly string[];
  readonly images: readonly CanonicalImageFingerprint[];
}

/**
 * Computes a deterministic SHA-256 hash over the canonical product identity.
 * Normalizes case and trims whitespace while preserving image order because
 * the first image is semantically the hero image in alt-only processing.
 */
export function computeProductInputHash(input: SeoContentInput): string {
  const variantSummary = input.variantSummary ?? summarizeVariants(input.variants);
  const normalized: CanonicalProductIdentity = {
    storeId: (input.storeId ?? "").trim().toLowerCase(),
    siteDomain: (input.siteDomain ?? "").trim().toLowerCase(),
    productId: (input.productId ?? "").trim(),
    sourceUrl: (input.url ?? "").trim(),
    sourceVersion: (input.sourceVersion ?? "").trim(),
    shopifyUpdatedAt: (input.shopifyUpdatedAt ?? "").trim(),
    providerId: (input.providerId ?? "gemini").trim().toLowerCase(),
    pipelineVersion: (input.pipelineVersion ?? "seo-b1-b6-v1").trim().toLowerCase(),
    handle: (input.handle ?? "").trim().toLowerCase(),
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    niche: (input.niche ?? "").trim().toLowerCase(),
    variantLabel: (input.variantLabel ?? "").trim(),
    variantSummary: {
      variantCount: variantSummary.variantCount,
      optionNames: [...variantSummary.optionNames].map((name) => name.trim()).sort(),
      sampleVariants: variantSummary.sampleVariants.map((variant) => ({
        title: variant.title.trim(),
        ...(variant.price ? { price: variant.price.trim() } : {}),
        ...(variant.sku ? { sku: variant.sku.trim() } : {}),
        ...(variant.options ? {
          options: Object.fromEntries(
            Object.entries(variant.options)
              .map(([key, value]) => [key.trim(), value.trim()] as const)
              .sort(([left], [right]) => left.localeCompare(right)),
          ),
        } : {}),
      })),
      minPrice: variantSummary.minPrice,
      maxPrice: variantSummary.maxPrice,
    },
    existingPrimaryKeyword: (input.existingPrimaryKeyword ?? "").trim().toLowerCase(),
    existingKeywords: Object.freeze(
      [...(input.existingKeywords ?? [])]
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
        .sort(),
    ),
    images: Object.freeze(
      (input.images ?? [])
        .map((image) => ({
          id: (image?.id ?? "").trim(),
          url: (image?.url ?? "").trim(),
          alt: (image?.alt ?? "").trim(),
          localFilePath: (image?.localFilePath ?? "").trim(),
          contentFingerprint: (image?.contentFingerprint ?? "").trim(),
        }))
    ),
  };

  const payload = JSON.stringify(normalized);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Computes a deterministic SHA-256 hash representing the complete input,
 * upstream lineage, prompt version, and model configuration of a pipeline stage.
 */
export function computeStageHash(
  stageName: string,
  inputHash: string,
  upstreamHash: string,
  promptVersion: string,
  model: string,
  extraConfig?: Readonly<Record<string, unknown>>,
): string {
  const sortedExtraConfig = extraConfig
    ? Object.keys(extraConfig)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = extraConfig[key];
          return acc;
        }, {})
    : undefined;

  const payload = {
    stageName: stageName.trim().toLowerCase(),
    inputHash: inputHash.trim(),
    upstreamHash: upstreamHash.trim(),
    promptVersion: promptVersion.trim(),
    model: model.trim(),
    ...(sortedExtraConfig ? { extraConfig: sortedExtraConfig } : {}),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function computeSeoResultCacheKey(input: {
  readonly inputHash: string;
  readonly corpusRevision: number;
  readonly promptVersion: string;
  readonly model: string;
  readonly pipelineVersion: string;
}): string {
  return computeStageHash(
    "result-cache",
    input.inputHash,
    String(input.corpusRevision),
    input.promptVersion,
    input.model,
    { pipelineVersion: input.pipelineVersion },
  );
}
