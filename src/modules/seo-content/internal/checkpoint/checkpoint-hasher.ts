import { createHash } from "node:crypto";

import type { SeoContentInput } from "../../types";

export interface CanonicalProductIdentity {
  readonly storeId: string;
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly niche: string;
  readonly imageUrls: readonly string[];
}

/**
 * Computes a deterministic SHA-256 hash over the canonical product identity.
 * Normalizes case, trims whitespace, and sorts image URLs so identical
 * products with different ordering or formatting yield the exact same hash.
 */
export function computeProductInputHash(input: SeoContentInput): string {
  const normalized: CanonicalProductIdentity = {
    storeId: (input.storeId ?? "").trim().toLowerCase(),
    productId: (input.productId ?? "").trim(),
    handle: (input.handle ?? "").trim().toLowerCase(),
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    niche: (input.niche ?? "").trim().toLowerCase(),
    imageUrls: Object.freeze(
      (input.images ?? [])
        .map((img) => (img?.url ?? "").trim())
        .filter((url): url is string => url.length > 0)
        .sort(),
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
