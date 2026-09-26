import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "./product-image-analyzer";
import {
  parseGeminiProductImageAnalysis,
} from "./gemini-analysis-schema";
import { prepareProductImagePayload } from "./product-image-payload";
import type { GeminiContentGenerator } from "./gemini-content-generator";
import { GeminiGeneratorError } from "./gemini-content-generator";
import {
  type AsyncSemaphore,
  getSharedGeminiVisionSemaphore,
} from "./async-semaphore";
import {
  executeWithExponentialBackoff,
  type GeminiRetryOptions,
} from "./gemini-retry";

export const GEMINI_B1_SYSTEM_INSTRUCTION = `You are an evidence extraction system for ecommerce product images.

Your task is to inspect the supplied product-image batch and return structured evidence only.

Rules:
1. Product anchoring:
   - Use niche and title to identify the sold product, not incidental objects in its setting.
   - Product/design detail belongs only in typography, visualEntities, and physicalProductIdentity.
   - Background furniture, rooms, people and props belong only in sceneContext.
2. Typography:
   - typography.visibleTexts contains only text visibly printed, embroidered, or engraved directly on the product/design (e.g. slogan, quotes, names, single words like 'VALHALLA', bible verses, brand names on graphic). Be precise and comprehensive about visible text on the graphic artwork.
   - Never infer OCR text from title, description, niche, filename or alt text.
   - Never correct spelling found in the image.
   - Preserve visible wording, casing and punctuation where possible.
   - Exclude website UI, watermarks, image-editor overlays and unrelated background text unless they are part of the sold product/design.
   - If no reliable visible text exists, return [].

   - typography.styleSummary states the visual treatment of that product text.
3. visualEntities is one rich, product-design-only English summary of the central graphic design elements, artistic motifs, emblems, symbols, or patterns on the product (e.g., 'Viking round shield with crossed battle axes and ornate knotwork', 'Thor Mjolnir hammer with skull and lightning'). Prioritize distinctive artistic themes and central subject matter over generic product attributes. Do not list scene objects.
4. sceneContext is one English description of the placement/space only.
5. physicalProductIdentity is the physical blank/object (for example "area rug", "quilt bedding set", "t-shirt"), never Shopify category or product type.
   - Decide it from cross-batch evidence, not the first image or repeated backgrounds.
   - Return "unknown" where evidence is insufficient.

The supplied title, description and niche are contextual hints only.
They are never evidence for OCR.
Do not fabricate details that are not visible.`;

export interface GeminiProductImageAnalyzerOptions {
  readonly generator: GeminiContentGenerator;
  readonly model?: string;
  readonly systemInstruction?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxImages?: number;
  readonly semaphore?: AsyncSemaphore;
  readonly retryOptions?: GeminiRetryOptions;
}

function describeImageReadFailure(error: unknown): string {
  let cause: unknown = error;
  for (let depth = 0; depth < 3; depth++) {
    if (!cause || typeof cause !== "object") break;
    if ("code" in cause && typeof cause.code === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(cause.code)) {
      return cause.code;
    }
    cause = "cause" in cause ? cause.cause : undefined;
  }
  const message = error instanceof Error ? error.message : "";
  const httpStatus = message.match(/HTTP error (\d{3})/);
  if (httpStatus) return `HTTP ${httpStatus[1]}`;
  if (/timed out|AbortError/i.test(message)) return "timeout";
  if (/exceeds maximum|too large/i.test(message)) return "image too large";
  if (/content-type|mime type/i.test(message)) return "unsupported image format";
  if (/Unsupported image target|neither localFilePath nor url/i.test(message)) return "invalid image URL";
  return "image read failed";
}

export class GeminiProductImageAnalyzer implements ProductImageAnalyzer {
  private readonly generator: GeminiContentGenerator;
  private readonly model?: string;
  private readonly systemInstruction: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs?: number;
  private readonly maxRetries?: number;
  private readonly maxImages?: number;
  private readonly semaphore: AsyncSemaphore;
  private readonly retryOptions?: GeminiRetryOptions;

  constructor(options: GeminiProductImageAnalyzerOptions) {
    this.generator = options.generator;
    this.model = options.model;
    this.systemInstruction = options.systemInstruction || GEMINI_B1_SYSTEM_INSTRUCTION;
    this.maxOutputTokens = Math.min(options.maxOutputTokens || 2048, 2048);
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.maxImages = options.maxImages;
    this.semaphore = options.semaphore ?? getSharedGeminiVisionSemaphore();
    this.retryOptions = options.retryOptions;
  }

  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    const limit = input.maxImages ?? this.maxImages;
    const maxPayloads = typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : input.images.length;
    const imagePayloads: Awaited<ReturnType<typeof prepareProductImagePayload>>[] = [];
    const failures: string[] = [];
    let nextImageIndex = 0;
    while (nextImageIndex < input.images.length && imagePayloads.length < maxPayloads) {
      // A small second candidate lets alt-only SEO recover from a broken cover image.
      const batchSize = Math.max(2, maxPayloads - imagePayloads.length);
      const candidates = input.images.slice(nextImageIndex, nextImageIndex + batchSize);
      const prepared = await Promise.allSettled(candidates.map((image) => prepareProductImagePayload(image, {
        fetchTimeoutMs: this.timeoutMs,
      })));
      for (const result of prepared) {
        if (result.status === "fulfilled") {
          if (imagePayloads.length < maxPayloads) imagePayloads.push(result.value);
        } else {
          failures.push(describeImageReadFailure(result.reason));
        }
      }
      nextImageIndex += candidates.length;
    }
    if (imagePayloads.length === 0) {
      const reasons = [...new Set(failures)].slice(0, 3).join(", ") || "no images provided";
      throw new GeminiGeneratorError(
        `No readable product images were available for B1 analysis (tried ${failures.length} images; reasons: ${reasons}).`,
      );
    }

    const prompt = `Analyze this ecommerce product image batch (${imagePayloads.length} readable image${imagePayloads.length === 1 ? "" : "s"} in supplied order).

Product context:
Title: ${input.title || ""}
Description: ${input.description || ""}
Niche: ${input.niche || ""}

Extract exactly the four requested evidence groups.
Focus closely on the primary product design/artwork:
- Extract any prominent text or slogan printed on the design into typography.visibleTexts.
- Describe the key artistic/design entities (symbols, motifs, emblems, illustrations) in visualEntities.
- Identify the physical product blank in physicalProductIdentity.

Use product context only for disambiguation.
Visual evidence has priority over metadata.`;

    const effectiveRetryOptions: GeminiRetryOptions = {
      ...(this.retryOptions ?? {}),
      ...(this.maxRetries !== undefined ? { maxRetries: this.maxRetries } : {}),
    };

    const response = await this.semaphore.runExclusive(async () => {
      return executeWithExponentialBackoff(async () => {
        return this.generator.generateProductImageAnalysis({
          prompt,
          imagePayloads,
          systemInstruction: this.systemInstruction,
          model: this.model,
          maxOutputTokens: this.maxOutputTokens,
          timeoutMs: this.timeoutMs,
          retryOptions: effectiveRetryOptions,
        });
      }, effectiveRetryOptions);
    });

    return parseGeminiProductImageAnalysis(response.rawText);
  }
}
