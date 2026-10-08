import type {
  SeoCatalogPolicy,
  SeoProductDescriptionPolicy,
  SeoStoreProfile,
} from "../../types";

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
  readonly profileId: string;
  readonly profileVersion: string;
  readonly storeId: string;
  readonly storeAliases?: readonly string[];
  readonly storeName: string;
  readonly domainAliases: readonly string[];
  readonly niche: string;
  readonly productDescriptionPolicy?: SeoProductDescriptionPolicy;
  readonly bedding?: StoreBeddingProfileConfig;
  readonly descriptionGuidelines?: readonly string[];
  readonly seoDescriptionGuidelines?: {
    readonly mandatoryKeywords: readonly string[];
    readonly maxCharacters: number;
  };
}

function includesNormalized(value: string, terms: readonly string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}

export function findApplicableCatalogPolicy(
  profile: SeoStoreProfile,
  physicalProductIdentity: string | undefined,
  niche: string,
  confidence: number | undefined,
): SeoCatalogPolicy | undefined {
  const identity = physicalProductIdentity?.trim() ?? "";
  if (!identity || identity.toLowerCase() === "unknown") return undefined;

  return profile.catalogPolicies?.find((policy) =>
    includesNormalized(niche, policy.applicableNiches)
    && includesNormalized(identity, policy.productIdentityTerms)
    && confidence !== undefined
    && confidence >= policy.minimumIdentityConfidence,
  );
}

/**
 * Projects the versioned public store profile into the legacy formatter view.
 * The bedding view is activated only when grounded B1 identity plus niche match
 * the policy. Store identity by itself is deliberately insufficient.
 */
export function projectStoreContentProfile(
  profile: SeoStoreProfile,
  physicalProductIdentity: string | undefined,
  niche: string,
  confidence: number | undefined,
): StoreContentProfile {
  const policy = findApplicableCatalogPolicy(profile, physicalProductIdentity, niche, confidence);
  const fabricMaterial = policy?.allowedClaims.find((claim) => claim.startsWith("material:"))?.slice("material:".length).trim();
  const printTechnology = policy?.allowedClaims.find((claim) => claim.startsWith("print:"))?.slice("print:".length).trim();
  const careGuidance = policy?.allowedClaims.find((claim) => claim.startsWith("care:"))?.slice("care:".length).trim();

  return {
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    storeId: profile.storeId,
    storeName: profile.storeName,
    domainAliases: [],
    niche: profile.niche,
    ...(profile.productDescriptionPolicy
      ? { productDescriptionPolicy: profile.productDescriptionPolicy }
      : {}),
    ...(policy && fabricMaterial && printTechnology && careGuidance ? {
      bedding: {
        options: policy.offerings,
        fabricMaterial,
        printTechnology,
        careGuidance,
      },
      descriptionGuidelines: policy.requiredContentRules,
      seoDescriptionGuidelines: {
        mandatoryKeywords: policy.offerings.map((offering) => offering.name),
        maxCharacters: profile.seoConstraints.maxDescriptionCharacters,
      },
    } : {}),
  };
}
