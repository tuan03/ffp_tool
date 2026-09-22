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

Your task is to inspect the supplied product image and return structured visual evidence only.

Rules:
1. OCR:
   - ocrTexts must contain only text visibly present on the product/design.
   - Never infer OCR text from title, description, niche, filename or alt text.
   - Never correct spelling found in the image.
   - Preserve visible wording, casing and punctuation where possible.
   - Exclude website UI, watermarks, image-editor overlays and unrelated background text unless they are part of the sold product/design.
   - If no reliable visible text exists, return [].

2. detectedEntities:
   - Return concrete visible subjects, motifs or design elements.
   - Examples: black cat, pumpkin, butterfly, moon, daisy.
   - Do not invent invisible concepts.
   - Do not include generic terms such as image, background or design.

3. dominantColors:
   - Return the major visually dominant colors.
   - Use common normalized color names.
   - Order them from most visually prominent to least prominent.

4. visualStyle:
   - Return one concise style phrase.
   - Examples: vintage retro illustration, minimalist typography, cute cartoon, gothic floral.
   - Do not return a sentence.
   - Return "unknown" when evidence is insufficient.

5. productCategory:
   - Identify the physical product shown.
   - Examples: t-shirt, hoodie, ceramic mug, leather handbag.
   - Use the provided product context only to resolve genuine visual ambiguity.
   - Return "unknown" if it cannot be determined reliably.

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
    const imagePayload = await prepareProductImagePayload(input.image, {
      fetchTimeoutMs: this.timeoutMs,
    });

    const prompt = `Analyze this ecommerce product image.

Product context:
Title: ${input.title || ""}
Description: ${input.description || ""}
Niche: ${input.niche || ""}

Extract:
- visible product/design text
- visible entities and motifs
- dominant colors
- visual style
- physical product category

Use product context only for disambiguation.
Visual evidence has priority over metadata.`;

    let lastError: unknown;
    const maxAttempts = 1 + Math.max(0, this.maxRetries);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.generator.generateProductImageAnalysis({
          prompt,
          imagePayload,
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
