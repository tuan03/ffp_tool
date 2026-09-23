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

export const GEMINI_B1_SYSTEM_INSTRUCTION = `You are an evidence extraction system for ecommerce product images.

Your task is to inspect the supplied product-image batch and return structured evidence only.

Rules:
1. Product anchoring:
   - Use niche and title to identify the sold product, not incidental objects in its setting.
   - Product/design detail belongs only in typography, visualEntities, and physicalProductIdentity.
   - Background furniture, rooms, people and props belong only in sceneContext.
2. Typography:
   - typography.visibleTexts contains only text visibly present on the product/design.
   - Never infer OCR text from title, description, niche, filename or alt text.
   - Never correct spelling found in the image.
   - Preserve visible wording, casing and punctuation where possible.
   - Exclude website UI, watermarks, image-editor overlays and unrelated background text unless they are part of the sold product/design.
   - If no reliable visible text exists, return [].

   - typography.styleSummary states the visual treatment of that product text.
3. visualEntities is one rich, product-design-only English summary. Do not list scene objects.
4. sceneContext is one English description of the placement/space only.
5. physicalProductIdentity is the physical blank/object (for example "area rug"), never Shopify category or product type.
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
  readonly maxRetries?: number; // default 1
}

export class GeminiProductImageAnalyzer implements ProductImageAnalyzer {
  private readonly generator: GeminiContentGenerator;
  private readonly model?: string;
  private readonly systemInstruction: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs?: number;
  private readonly maxRetries: number;

  constructor(options: GeminiProductImageAnalyzerOptions) {
    this.generator = options.generator;
    this.model = options.model;
    this.systemInstruction = options.systemInstruction || GEMINI_B1_SYSTEM_INSTRUCTION;
    this.maxOutputTokens = Math.min(options.maxOutputTokens || 2048, 2048);
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries ?? 1;
  }

  async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
    const prepared = await Promise.allSettled(input.images.map((image) => prepareProductImagePayload(image, {
      fetchTimeoutMs: this.timeoutMs,
    })));
    const imagePayloads = prepared.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (imagePayloads.length === 0) {
      throw new GeminiGeneratorError("No readable product images were available for B1 analysis");
    }

    const prompt = `Analyze this ecommerce product image batch (${imagePayloads.length} readable images in supplied order).

Product context:
Title: ${input.title || ""}
Description: ${input.description || ""}
Niche: ${input.niche || ""}

Extract exactly the four requested evidence groups.

Use product context only for disambiguation.
Visual evidence has priority over metadata.`;

    let lastError: unknown;
    const maxAttempts = 1 + Math.max(0, this.maxRetries);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.generator.generateProductImageAnalysis({
          prompt,
      imagePayloads,
          systemInstruction: this.systemInstruction,
          model: this.model,
          maxOutputTokens: this.maxOutputTokens,
          timeoutMs: this.timeoutMs,
        });

        return parseGeminiProductImageAnalysis(response.rawText);
      } catch (err) {
        lastError = err;

        const isRetryable =
          err instanceof GeminiGeneratorError && err.isRetryable && attempt < maxAttempts;

        if (!isRetryable) {
          throw err;
        }

        // Brief delay before retry
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    throw lastError;
  }
}
