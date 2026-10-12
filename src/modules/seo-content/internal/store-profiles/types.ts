import { toProductIdentityTitleCase } from "./product-title-identity";

import type {
  SeoCatalogPolicy,
  SeoProductDescriptionPolicy,
  SeoProductTitleIdentityPolicy,
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

export interface StoreProductTitleIdentity {
  readonly policyId: string;
  readonly preferredTerm: string;
  readonly acceptedTerms: readonly string[];
}

export interface StoreProductTitleIdentityConflict {
  readonly productType: string;
  readonly physicalProductIdentity: string;
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
  readonly titleIdentity?: StoreProductTitleIdentity;
  readonly titleIdentityConflict?: StoreProductTitleIdentityConflict;
  readonly bedding?: StoreBeddingProfileConfig;
  readonly descriptionGuidelines?: readonly string[];
  readonly seoDescriptionGuidelines?: {
    readonly mandatoryKeywords: readonly string[];
    readonly maxCharacters: number;
  };
}

const MINIMUM_FALLBACK_IDENTITY_CONFIDENCE = 0.8;

function equalsNormalized(value: string, terms: readonly string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return terms.some((term) => normalized === term.trim().toLowerCase());
}

function includesNormalized(value: string, terms: readonly string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return terms.some((term) => normalized.includes(term.trim().toLowerCase()));
}

function includesNormalizedPhrase(value: string, terms: readonly string[]): boolean {
  const normalizedValue = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return terms.some((term) => {
    const normalizedTerm = term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalizedTerm.length > 0 && normalizedValue.includes(` ${normalizedTerm} `);
  });
}

export function findApplicableProductTitleIdentityPolicy(
  profile: SeoStoreProfile,
  physicalProductIdentity: string | undefined,
  productType: string,
  confidence: number | undefined,
): SeoProductTitleIdentityPolicy | undefined {
  const identity = physicalProductIdentity?.trim() ?? "";
  if (!identity || identity.toLowerCase() === "unknown" || confidence === undefined) return undefined;

  return profile.productTitleIdentityPolicies?.find((policy) =>
    equalsNormalized(productType, policy.applicableProductTypes)
    && includesNormalizedPhrase(identity, policy.physicalIdentityTerms)
    && confidence >= policy.minimumIdentityConfidence,
  );
}

function resolveProductTitleIdentity(
  profile: SeoStoreProfile,
  physicalProductIdentity: string | undefined,
  productType: string,
  confidence: number | undefined,
): StoreProductTitleIdentity | undefined {
  const configured = findApplicableProductTitleIdentityPolicy(
    profile,
    physicalProductIdentity,
    productType,
    confidence,
  );
  if (configured) {
    return {
      policyId: configured.policyId,
      preferredTerm: configured.preferredTitleTerm,
      acceptedTerms: configured.acceptedTitleTerms,
    };
  }

  const hasConfiguredProductType = profile.productTitleIdentityPolicies?.some((policy) =>
    equalsNormalized(productType, policy.applicableProductTypes),
  ) ?? false;
  if (hasConfiguredProductType) return undefined;

  const identity = physicalProductIdentity?.trim() ?? "";
  if (
    !identity
    || identity.toLowerCase() === "unknown"
    || confidence === undefined
    || confidence < MINIMUM_FALLBACK_IDENTITY_CONFIDENCE
  ) {
    return undefined;
  }

  const preferredTerm = toProductIdentityTitleCase(identity);
  return {
    policyId: "grounded-product-identity-fallback",
    preferredTerm,
    acceptedTerms: [preferredTerm],
  };
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
  const titleIdentity = resolveProductTitleIdentity(
    profile,
    physicalProductIdentity,
    niche,
    confidence,
  );
  const identity = physicalProductIdentity?.trim() ?? "";
  const hasConfiguredProductType = profile.productTitleIdentityPolicies?.some((candidate) =>
    equalsNormalized(niche, candidate.applicableProductTypes),
  ) ?? false;
  const titleIdentityConflict = !titleIdentity
    && hasConfiguredProductType
    && identity.length > 0
    && identity.toLowerCase() !== "unknown"
    && confidence !== undefined
    && confidence >= MINIMUM_FALLBACK_IDENTITY_CONFIDENCE
      ? { productType: niche, physicalProductIdentity: identity }
      : undefined;
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
    ...(titleIdentity ? { titleIdentity } : {}),
    ...(titleIdentityConflict ? { titleIdentityConflict } : {}),
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
