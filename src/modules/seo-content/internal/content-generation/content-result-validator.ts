import type {
  ContentConstraints,
  ContentFactSheet,
  ContentResult,
  GeneratedContentDraft,
  GeneratedFaqItem,
  GeneratedStyleOption,
  KeywordAllocation,
} from "./content-generation-types";
import {
  ContentGenerationSchemaError,
  ContentGroundingViolationError,
  ContentHtmlSafetyError,
  ContentLengthViolationError,
} from "./content-generation-types";
import { checkClaimGrounding } from "./claim-guard";

const FORBIDDEN_HTML_PATTERNS: readonly RegExp[] = [
  /<script\b/i,
  /<style\b/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /\bon\w+\s*=/i, // inline event handlers (onclick=, onerror=, etc.)
  /javascript\s*:/i,
];

/**
 * Validates the raw draft structure emitted by Gemini or heuristic generator.
 */
export function validateDraft(raw: unknown): GeneratedContentDraft {
  if (!raw || typeof raw !== "object") {
    throw new ContentGenerationSchemaError("Generated draft must be an object");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.productTitle !== "string" || !obj.productTitle.trim()) {
    throw new ContentGenerationSchemaError("Missing or invalid 'productTitle' in draft");
  }

  if (typeof obj.intro !== "string" || !obj.intro.trim()) {
    throw new ContentGenerationSchemaError("Missing or invalid 'intro' in draft");
  }

  if (!Array.isArray(obj.bullets) || obj.bullets.length < 2) {
    throw new ContentGenerationSchemaError("Draft must contain at least 2 bullets");
  }

  for (const bullet of obj.bullets) {
    if (!bullet || typeof bullet !== "object") {
      throw new ContentGenerationSchemaError("Each bullet in draft must be an object");
    }
    const b = bullet as Record<string, unknown>;
    if (typeof b.label !== "string" || !b.label.trim()) {
      throw new ContentGenerationSchemaError("Bullet missing required 'label'");
    }
    if (typeof b.text !== "string" || !b.text.trim()) {
      throw new ContentGenerationSchemaError("Bullet missing required 'text'");
    }
  }

  if (typeof obj.closing !== "string" || !obj.closing.trim()) {
    throw new ContentGenerationSchemaError("Missing or invalid 'closing' in draft");
  }

  if (typeof obj.productSeoTitle !== "string" || !obj.productSeoTitle.trim()) {
    throw new ContentGenerationSchemaError("Missing or invalid 'productSeoTitle' in draft");
  }

  if (typeof obj.productSeoDescription !== "string" || !obj.productSeoDescription.trim()) {
    throw new ContentGenerationSchemaError("Missing or invalid 'productSeoDescription' in draft");
  }

  const guidance: string[] = [];
  if (Array.isArray(obj.guidance)) {
    for (const g of obj.guidance) {
      if (typeof g === "string" && g.trim()) {
        guidance.push(g.trim());
      }
    }
  }

  const aeo_quick_summary =
    typeof obj.aeo_quick_summary === "string" && obj.aeo_quick_summary.trim().length > 0
      ? obj.aeo_quick_summary.trim()
      : undefined;

  let aeo_faq: GeneratedFaqItem[] | undefined;
  if (Array.isArray(obj.aeo_faq)) {
    const validFaq: GeneratedFaqItem[] = [];
    for (const item of obj.aeo_faq) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).question === "string" &&
        typeof (item as Record<string, unknown>).answer === "string"
      ) {
        const q = ((item as Record<string, unknown>).question as string).trim();
        const a = ((item as Record<string, unknown>).answer as string).trim();
        if (q.length > 0 && a.length > 0) {
          validFaq.push({ question: q, answer: a });
        }
      }
    }
    if (validFaq.length > 0) {
      aeo_faq = validFaq;
    }
  }

  let styleOptions: GeneratedStyleOption[] | undefined;
  if (Array.isArray(obj.styleOptions)) {
    const validOptions: GeneratedStyleOption[] = [];
    for (const opt of obj.styleOptions) {
      if (
        opt &&
        typeof opt === "object" &&
        typeof (opt as Record<string, unknown>).name === "string" &&
        typeof (opt as Record<string, unknown>).description === "string"
      ) {
        const name = ((opt as Record<string, unknown>).name as string).trim();
        const description = ((opt as Record<string, unknown>).description as string).trim();
        if (name.length > 0 && description.length > 0) {
          validOptions.push({ name, description });
        }
      }
    }
    if (validOptions.length > 0) {
      styleOptions = validOptions;
    }
  }

  let aeo_json_ld =
    typeof obj.aeo_json_ld === "string" && obj.aeo_json_ld.trim().length > 0
      ? obj.aeo_json_ld.trim()
      : undefined;

  return {
    productTitle: obj.productTitle.trim(),
    intro: obj.intro.trim(),
    bullets: (obj.bullets as Array<{ label: string; text: string }>).map((b) => ({
      label: b.label.trim(),
      text: b.text.trim(),
    })),
    guidance,
    closing: obj.closing.trim(),
    productSeoTitle: obj.productSeoTitle.trim(),
    productSeoDescription: obj.productSeoDescription.trim(),
    ...(styleOptions ? { styleOptions } : {}),
    ...(aeo_quick_summary ? { aeo_quick_summary } : {}),
    ...(aeo_faq ? { aeo_faq } : {}),
    ...(aeo_json_ld ? { aeo_json_ld } : {}),
  };
}

/**
 * Validates the finalized ContentResult against length, SEO constraints, HTML safety, and grounding.
 */
export function validateFinalContent(
  result: ContentResult,
  draft: GeneratedContentDraft,
  facts: ContentFactSheet,
  keywords: KeywordAllocation,
  constraints: ContentConstraints,
): void {
  // 1. Length constraints
  if (result.productSeoTitle.length > constraints.maxSeoTitleLength) {
    throw new ContentLengthViolationError(
      `SEO Title exceeds maximum length of ${constraints.maxSeoTitleLength} chars`,
      "productSeoTitle",
      result.productSeoTitle.length,
      constraints.maxSeoTitleLength,
    );
  }

  if (result.productSeoDescription.length > constraints.maxSeoDescriptionLength) {
    throw new ContentLengthViolationError(
      `SEO Description exceeds maximum length of ${constraints.maxSeoDescriptionLength} chars`,
      "productSeoDescription",
      result.productSeoDescription.length,
      constraints.maxSeoDescriptionLength,
    );
  }

  // 2. HTML safety check
  for (const pattern of FORBIDDEN_HTML_PATTERNS) {
    if (pattern.test(result.productDescription)) {
      throw new ContentHtmlSafetyError(
        "Product description contains forbidden HTML tags, scripts, or event handlers",
      );
    }
  }

  // 3. Handle slug format check
  if (
    result.productHandle.trim().length > 0 &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.productHandle.trim())
  ) {
    throw new ContentGenerationSchemaError(
      `Product handle is not a valid kebab-case slug: '${result.productHandle}'`,
    );
  }

  // 4. Grounding and claim guard
  const violations = checkClaimGrounding(draft, facts);
  if (violations.length > 0) {
    throw new ContentGroundingViolationError(
      `Content violates factual grounding: ${violations.join("; ")}`,
      violations,
    );
  }
}
