import type { ContentGenerationMetadata, ContentResult } from "../domain-types";

export type { ContentGenerationMetadata, ContentResult };

export interface ContentFactSheet {
  readonly originalTitle: string;
  readonly originalDescription: string;
  readonly existingHandle?: string;
  readonly niche?: string;
  readonly physicalProductIdentity?: string;
  readonly typographyVisibleTexts: readonly string[];
  readonly typographyStyleSummary?: string;
  readonly visualEntities?: string;
  readonly targetAudience: readonly string[];
  readonly occasions: readonly string[];
  readonly useCases: readonly string[];
  readonly personalizationSupported: boolean;
}

export interface KeywordAllocation {
  readonly primary?: string;
  readonly secondary: readonly string[];
  readonly supportingKeywords: readonly string[];
  readonly framingConcepts: readonly string[];
  readonly targetedKeywords: readonly string[];
}

export interface GeneratedBullet {
  readonly label: string;
  readonly text: string;
}

export interface GeneratedContentDraft {
  readonly productTitle: string;
  readonly intro: string;
  readonly bullets: readonly GeneratedBullet[];
  readonly guidance: readonly string[];
  readonly closing: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
}

export interface ContentConstraints {
  readonly maxSeoTitleLength: number;
  readonly maxSeoDescriptionLength: number;
  readonly maxHandleLength: number;
  readonly maxBullets: number;
  readonly preserveExistingHandle: boolean;
}

export interface ContentGenerationInput {
  readonly facts: ContentFactSheet;
  readonly keywords: KeywordAllocation;
  readonly constraints: ContentConstraints;
}

export interface ContentGenerator {
  generate(input: ContentGenerationInput): Promise<GeneratedContentDraft>;
}

export class ContentGenerationSchemaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ContentGenerationSchemaError";
  }
}

export class ContentGroundingViolationError extends Error {
  constructor(message: string, readonly violatedClaims: readonly string[]) {
    super(message);
    this.name = "ContentGroundingViolationError";
  }
}

export class ContentLengthViolationError extends Error {
  constructor(message: string, readonly field: string, readonly length: number, readonly maxLength: number) {
    super(message);
    this.name = "ContentLengthViolationError";
  }
}

export class ContentHtmlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentHtmlSafetyError";
  }
}

export class ContentKeywordViolationError extends Error {
  constructor(message: string, readonly keyword: string) {
    super(message);
    this.name = "ContentKeywordViolationError";
  }
}
