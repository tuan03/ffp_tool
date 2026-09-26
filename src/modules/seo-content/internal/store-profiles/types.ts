export interface StoreVariantOptionSpec {
  readonly name: string;
  readonly shortDescription: string;
  readonly detailedFeatures: string;
}

export interface StoreBeddingProfileConfig {
  readonly options: readonly StoreVariantOptionSpec[];
  readonly fabricMaterial: string;
  readonly printTechnology: string;
  readonly careGuidance: string;
}

export interface StoreContentProfile {
  readonly storeId: string;
  readonly storeName: string;
  readonly domainAliases: readonly string[];
  readonly niche: string;
  readonly bedding?: StoreBeddingProfileConfig;
  readonly descriptionGuidelines?: readonly string[];
  readonly seoDescriptionGuidelines?: {
    readonly mandatoryKeywords: readonly string[];
    readonly maxCharacters: number;
  };
}
