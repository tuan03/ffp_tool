import type {
  ProductUnderstanding,
  ShoppingContext,
} from "../domain-types";
import type { SeoContentInput } from "../../types";

export interface ProductReferences {
  readonly productIdentityText: string;
  readonly shoppingIntentText: string;
}

export interface BuildProductReferencesInput {
  readonly source: SeoContentInput;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
}

/**
 * Builds dual semantic reference texts for vector embedding comparison:
 * 1. Product Identity: Encapsulates objective physical/visual attributes and category truth.
 * 2. Shopping Intent: Encapsulates commercial buyer intent, use cases, occasions, and target persona.
 */
export function buildProductReferences(
  input: BuildProductReferencesInput,
): ProductReferences {
  const { source, productUnderstanding, shoppingContext } = input;

  // 1. Reference A — Product Identity
  const physicalProductIdentity = (productUnderstanding?.physicalProductIdentity || "").trim();
  const title = (source.title || "").trim();
  const niche = (source.niche || "").trim();
  const typography = (productUnderstanding?.typography.visibleTexts ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .join(", ");
  const typographyStyle = (productUnderstanding?.typography.styleSummary || "").trim();
  const visualEntities = (productUnderstanding?.visualEntities || "").trim();

  const identityParts: string[] = [];
  if (physicalProductIdentity) {
    identityParts.push(`Physical Product Identity: ${physicalProductIdentity}`);
  }
  if (title) {
    identityParts.push(`Product Title: ${title}`);
  }
  if (niche) {
    identityParts.push(`Product Niche: ${niche}`);
  }
  if (visualEntities && visualEntities !== "unknown") {
    identityParts.push(`Visual Entities: ${visualEntities}`);
  }
  if (typography) {
    identityParts.push(`Design Text: ${typography}`);
  }
  if (typographyStyle && typographyStyle !== "unknown") {
    identityParts.push(`Typography Style: ${typographyStyle}`);
  }

  // Fallback if structured B1 metadata is completely empty
  if (identityParts.length === 0) {
    identityParts.push(`Product: ${title || niche || "item"}`);
  }

  const productIdentityText = identityParts.join(". ");

  // 2. Reference B — Shopping Intent
  const buyerIntents = (shoppingContext?.buyerIntentKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean)
    .join(", ");
  const audience = (shoppingContext?.targetAudience ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .join(", ");
  const occasions = (shoppingContext?.suitableOccasions ?? [])
    .map((o) => o.trim())
    .filter(Boolean)
    .join(", ");
  const useCases = (shoppingContext?.useCases ?? [])
    .map((u) => u.trim())
    .filter(Boolean)
    .join(", ");

  const intentParts: string[] = [];
  if (buyerIntents) {
    intentParts.push(`Buyer Search Intent: ${buyerIntents}`);
  }
  if (audience) {
    intentParts.push(`Target Audience: ${audience}`);
  }
  if (occasions) {
    intentParts.push(`Suitable Occasions: ${occasions}`);
  }
  if (useCases) {
    intentParts.push(`Product Use Cases: ${useCases}`);
  }

  // Fallback if shopping context is empty
  if (intentParts.length === 0) {
    intentParts.push(`Commercial Intent: ${title || niche || "shop product"}`);
  }

  const shoppingIntentText = intentParts.join(". ");

  return {
    productIdentityText,
    shoppingIntentText,
  };
}
