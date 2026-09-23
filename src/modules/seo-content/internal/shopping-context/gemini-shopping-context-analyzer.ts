import type { ShoppingContext } from "../domain-types";
import type {
  ShoppingContextAnalysisInput,
  ShoppingContextAnalyzer,
} from "./shopping-context-analyzer";
import type {
  GeminiContentGenerator,
  GeminiStructuredTextRequest,
} from "../product-understanding/gemini-content-generator";
import { GeminiGeneratorError } from "../product-understanding/gemini-content-generator";
import { GEMINI_SHOPPING_CONTEXT_SCHEMA } from "./gemini-shopping-context-schema";
import {
  parseAndNormalizeShoppingContext,
  ShoppingContextSchemaValidationError,
} from "./shopping-context-normalizer";

export const GEMINI_SHOPPING_CONTEXT_SYSTEM_INSTRUCTION = `You are an ecommerce shopping-context inference system.

Your task is to infer plausible shopping audiences, occasions, use cases, and buyer-intent search seed phrases for the supplied product.

Use only evidence available in:
- product understanding from visual analysis
- product title
- product description
- niche

Important rules:

1. Evidence grounding:
- Prefer explicit product evidence over generic assumptions.
- Physical product identity, typography and visual entities are product-grounded evidence.
- The handle is low-priority metadata.

2. Audience:
- Return concise ecommerce audience segments.
- Distinguish likely product users from gift buyers when evidence supports gifting.
- Do not infer demographic or sensitive characteristics solely from colors, visual style or weak visual clues.
- A protected or identity-related audience may only be used when the product explicitly targets that audience in its text/design/context.

3. Occasions:
- Return only occasions reasonably connected to the product.
- Seasonal themes such as Halloween or Christmas are strong occasion signals.
- Do not invent holidays or life events without evidence.
- "Everyday use" is acceptable when no specific occasion is supported.

4. Use cases:
- Use cases must match the physical product category.
- Do not generate impossible or irrelevant uses.

5. Buyer-intent keywords:
- These are candidate seed phrases for later search research.
- They are NOT verified search queries and do not imply search volume.
- Prefer natural ecommerce phrases of roughly 2–8 words.
- Combine strong dimensions where useful: product category, motif/theme, audience, occasion, style, personalization.
- Include the product category in product-specific phrases when natural.
- Avoid keyword stuffing.
- Avoid near-duplicate phrases.
- Do not add "best", "cheap", "sale", "near me", "ideas", marketplace names, shipping claims or unsupported attributes.
- Only use "personalized", "custom", recipient relationships, professions or occasions when supported by evidence.

6. Precision:
- Prefer fewer strong inferences over many speculative ones.`;

export interface GeminiShoppingContextAnalyzerOptions {
  readonly generator: GeminiContentGenerator;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxOutputTokens?: number;
}

export class GeminiShoppingContextAnalyzer implements ShoppingContextAnalyzer {
  private readonly generator: GeminiContentGenerator;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxOutputTokens: number;

  constructor(options: GeminiShoppingContextAnalyzerOptions) {
    this.generator = options.generator;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs || 25000;
    this.maxRetries = options.maxRetries ?? 1;
    this.maxOutputTokens = options.maxOutputTokens ?? 2048;
  }

  async analyze(input: ShoppingContextAnalysisInput): Promise<ShoppingContext> {
    const prompt = this.buildPrompt(input);

    const request: GeminiStructuredTextRequest = {
      prompt,
      systemInstruction: GEMINI_SHOPPING_CONTEXT_SYSTEM_INSTRUCTION,
      responseJsonSchema: GEMINI_SHOPPING_CONTEXT_SCHEMA,
      model: this.model,
      timeoutMs: this.timeoutMs,
      temperature: 0,
      maxOutputTokens: this.maxOutputTokens,
    };

    let attempts = 0;
    while (true) {
      attempts++;
      try {
        if (!this.generator.generateStructuredText) {
          throw new GeminiGeneratorError(
            "Underlying GeminiContentGenerator does not implement generateStructuredText",
          );
        }

        const response = await this.generator.generateStructuredText(request);
        const parsed = parseAndNormalizeShoppingContext(response.rawText);
        return parsed;
      } catch (error) {
        if (error instanceof ShoppingContextSchemaValidationError) {
          // Schema validation errors should not be retried with the same parameters
          throw error;
        }

        const isRetryable =
          error instanceof GeminiGeneratorError ? error.isRetryable : false;

        if (isRetryable && attempts <= this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        throw error;
      }
    }
  }

  public buildPrompt(input: ShoppingContextAnalysisInput): string {
    const { source, productUnderstanding: pu } = input;

    const typography = pu?.typography.visibleTexts.join(", ") || "none";

    return `Analyze the shopping context for this ecommerce product.

SOURCE PRODUCT
Niche: ${source.niche || "unspecified"}
Title: ${source.title || "unspecified"}
Description: ${source.description || "unspecified"}
Handle: ${source.handle || "unspecified"}

PRODUCT UNDERSTANDING
Physical product identity: ${pu?.physicalProductIdentity || "unknown"}
Typography visible text: ${typography}
Typography styling: ${pu?.typography.styleSummary || "unknown"}
Visual entities: ${pu?.visualEntities || "unknown"}

Return:
- target audiences
- suitable purchase/use/gifting occasions
- realistic product use cases
- buyer-intent seed phrases for downstream search research`;
  }
}
