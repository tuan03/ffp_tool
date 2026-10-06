import { createHash } from "node:crypto";

import type { SeoContentInput } from "../../types";
interface CanonicalImageFingerprint {
  readonly id: string;
  readonly url: string;
  readonly contentFingerprint: string;
}

export interface CanonicalProductIdentity {
  readonly niche: string;
  readonly storeProfile: SeoContentInput["storeProfile"];
  readonly images: readonly CanonicalImageFingerprint[];
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * Computes a deterministic SHA-256 hash over the canonical product identity.
 * Normalizes case and trims whitespace while preserving image order because
 * the first image is semantically the hero image in alt-only processing.
 */
export function computeProductInputHash(input: SeoContentInput): string {
  const normalized: CanonicalProductIdentity = {
    niche: (input.niche ?? "").trim().toLowerCase(),
    storeProfile: input.storeProfile,
    images: Object.freeze(
      (input.images ?? [])
        .map((image) => ({
          id: (image?.id ?? "").trim(),
          url: (image?.url ?? "").trim(),
          contentFingerprint: (image?.contentFingerprint ?? "").trim(),
        }))
    ),
  };

  const payload = JSON.stringify(stableJsonValue(normalized));
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
