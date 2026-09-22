import type {
  ContentGenerationInput,
  ContentGenerator,
  GeneratedContentDraft,
} from "./content-generation-types";
import { checkClaimGrounding } from "./claim-guard";

export interface GeneratedContentWithOrigin {
  readonly draft: GeneratedContentDraft;
  readonly generator: "gemini" | "heuristic";
}

export class FallbackContentGenerator implements ContentGenerator {
  constructor(
    private readonly primary: ContentGenerator,
    private readonly fallback: ContentGenerator,
    private readonly onFallback?: (reason: string, error?: unknown) => void,
  ) {}

  async generateWithOrigin(input: ContentGenerationInput): Promise<GeneratedContentWithOrigin> {
    try {
      const draft = await this.primary.generate(input);

      // Verify that primary draft does not violate claim grounding
      const violations = checkClaimGrounding(draft, input.facts);
      if (violations.length > 0) {
        throw new Error(
          `Primary Gemini draft violated factual grounding: ${violations.join("; ")}`,
        );
      }

      return { draft, generator: "gemini" };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      if (this.onFallback) {
        this.onFallback(reason, error);
      } else {
        console.warn(
          `[SEO B5 Fallback] Gemini content generation failed for product '${input.facts.originalTitle}'. Falling back to heuristic generator. Cause: ${reason}`,
        );
      }

      const fallbackDraft = await this.fallback.generate(input);
      return { draft: fallbackDraft, generator: "heuristic" };
    }
  }

  async generate(input: ContentGenerationInput): Promise<GeneratedContentDraft> {
    const result = await this.generateWithOrigin(input);
    return result.draft;
  }
}
