import { pathToFileURL } from "node:url";
import path from "node:path";

import type { SeoContentInput, SeoContentOutput } from "../../src/modules/seo-content";
import type { SeoPipelineContext } from "../../src/modules/seo-content/internal/domain-types";
import type { SeoPipelineStage } from "../../src/modules/seo-content/internal/pipeline";

export interface SerializedSmokeImage {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: {
    readonly filename: string;
    readonly localFilePath?: string;
    readonly url?: string;
  };
}

export interface SerializedSeoOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly productHandle: string;
  readonly images: readonly SerializedSmokeImage[];
}

export interface SmokeStageTrace {
  readonly stageName: SeoPipelineStage["name"];
  readonly context: SeoPipelineContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function parseImages(input: Record<string, unknown>, repositoryRoot: string): SeoContentInput["images"] {
  const rawImages = input.images;
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    throw new Error("At least one image is required");
  }

  return rawImages.map((rawImage, index) => {
    if (!isRecord(rawImage)) {
      throw new Error(`images[${index}] must be an object`);
    }

    const localFilePath =
      typeof rawImage.localFilePath === "string" && rawImage.localFilePath.trim() !== ""
        ? path.resolve(repositoryRoot, rawImage.localFilePath.trim())
        : undefined;
    const url = typeof rawImage.url === "string" && rawImage.url.trim() !== ""
      ? rawImage.url.trim()
      : localFilePath
        ? pathToFileURL(localFilePath).toString()
        : undefined;

    if (!url) {
      throw new Error(`images[${index}] requires url or localFilePath`);
    }

    return {
      ...(typeof rawImage.id === "string" && rawImage.id.trim() !== "" ? { id: rawImage.id.trim() } : {}),
      url,
      ...(localFilePath ? { localFilePath } : {}),
      ...(typeof rawImage.alt === "string" && rawImage.alt.trim() !== "" ? { alt: rawImage.alt.trim() } : {}),
    };
  });
}

/** Converts a single smoke fixture item into the public SEO input contract. */
export function parseSingleSmokeInput(rawInput: unknown, repositoryRoot: string, itemPrefix = ""): SeoContentInput {
  if (!isRecord(rawInput)) {
    throw new Error(`${itemPrefix}Smoke input must be a JSON object`.trim());
  }

  const siteDomain =
    typeof rawInput.siteDomain === "string" && rawInput.siteDomain.trim() !== ""
      ? rawInput.siteDomain.trim()
      : undefined;

  return {
    title: requireText(rawInput, "title"),
    description: requireText(rawInput, "description"),
    niche: requireText(rawInput, "niche"),
    handle: requireText(rawInput, "handle"),
    images: parseImages(rawInput, repositoryRoot),
    ...(siteDomain ? { siteDomain } : {}),
  };
}

/** Parses single or multiple products from a smoke fixture. */
export function parseSmokeInputs(rawInput: unknown, repositoryRoot: string): readonly SeoContentInput[] {
  if (Array.isArray(rawInput)) {
    if (rawInput.length === 0) {
      throw new Error("Smoke input array must contain at least one product");
    }
    return rawInput.map((item, index) =>
      parseSingleSmokeInput(item, repositoryRoot, `Product #${index + 1}: `),
    );
  }

  if (isRecord(rawInput)) {
    if (Array.isArray(rawInput.items)) {
      if (rawInput.items.length === 0) {
        throw new Error("Smoke input items array must contain at least one product");
      }
      return rawInput.items.map((item, index) =>
        parseSingleSmokeInput(item, repositoryRoot, `Product #${index + 1}: `),
      );
    }
    return [parseSingleSmokeInput(rawInput, repositoryRoot)];
  }

  throw new Error("Smoke input must be a JSON object or array of products");
}

/** Converts a local, human-editable smoke fixture into the public SEO input contract (backward-compatible). */
export function parseSmokeInput(rawInput: unknown, repositoryRoot: string): SeoContentInput {
  const inputs = parseSmokeInputs(rawInput, repositoryRoot);
  const first = inputs[0];
  if (!first) {
    throw new Error("No products found in smoke input");
  }
  return first;
}

/** Removes binary image data before report JSON is persisted. */
export function serializeSeoOutput(output: SeoContentOutput): SerializedSeoOutput {
  return {
    productTitle: output.productTitle,
    productDescription: output.productDescription,
    productSeoTitle: output.productSeoTitle,
    productSeoDescription: output.productSeoDescription,
    productHandle: output.productHandle,
    images: output.images.map((image) => ({
      sourceUrl: image.sourceUrl,
      alt: image.alt,
      webp: {
        filename: image.webp.filename,
        ...(image.webp.localFilePath ? { localFilePath: image.webp.localFilePath } : {}),
        ...(image.webp.url ? { url: image.webp.url } : {}),
      },
    })),
  };
}

/** Wraps production stages for observability without changing their execution behavior. */
export function createTracingStages(
  stages: readonly SeoPipelineStage[],
  onStageCompleted: (trace: SmokeStageTrace) => void,
): readonly SeoPipelineStage[] {
  return stages.map((stage) => ({
    name: stage.name,
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const nextContext = await stage.execute(context);
      onStageCompleted({ stageName: stage.name, context: nextContext });
      return nextContext;
    },
  }));
}
