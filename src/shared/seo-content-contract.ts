export const SEO_CONTENT_INPUT_CONTRACT_VERSION = 2 as const;

export interface SeoContentImageInput {
  readonly id: string;
  readonly url: string;
  readonly contentFingerprint?: string;
}

export interface SeoCatalogOffering {
  readonly name: string;
  readonly shortDescription: string;
  readonly detailedFeatures: string;
}

export interface SeoCatalogPolicy {
  readonly policyId: string;
  readonly applicableNiches: readonly string[];
  readonly productIdentityTerms: readonly string[];
  readonly minimumIdentityConfidence: number;
  readonly offerings: readonly SeoCatalogOffering[];
  readonly allowedClaims: readonly string[];
  readonly requiredContentRules: readonly string[];
}

export interface SeoProductDescriptionPolicy {
  readonly mode: "visual-design-only";
  readonly excludedTopics: readonly string[];
}

export interface SeoStoreProfile {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly locale: string;
  readonly language: string;
  readonly niche: string;
  readonly brandVoice: readonly string[];
  readonly contentRules: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly productDescriptionPolicy?: SeoProductDescriptionPolicy;
  readonly seoConstraints: {
    readonly maxTitleCharacters: number;
    readonly maxDescriptionCharacters: number;
    readonly maxAltCharacters: number;
  };
  readonly catalogPolicies?: readonly SeoCatalogPolicy[];
}

export interface SeoContentGenerationInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly storeProfile: SeoStoreProfile;
}

export interface SeoExecutionEnvelope {
  readonly storeId: string;
  readonly productId?: string;
  readonly source: "amazon" | "auto_seo";
  readonly sourceIdentity: string;
  readonly sourceRevision?: string;
  readonly shopifyUpdatedAt?: string;
  readonly providerId: string;
  readonly pipelineVersion: string;
  readonly originalSnapshot: unknown;
}
