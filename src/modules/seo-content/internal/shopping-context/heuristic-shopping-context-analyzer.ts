import type { ShoppingContext } from "../domain-types";
import type {
  ShoppingContextAnalysisInput,
  ShoppingContextAnalyzer,
} from "./shopping-context-analyzer";
import {
  CATEGORY_RULES,
  DEFAULT_CATEGORY_RULE,
  ENTITY_AUDIENCE_ALLOWLIST,
  OCCASION_RULES,
  PERSONALIZATION_SIGNALS,
  ROLE_RECIPIENT_RULES,
  STYLE_RULES,
} from "./shopping-context-rules";
import {
  deduplicateAndNormalizeList,
} from "./shopping-context-normalizer";

export class HeuristicShoppingContextAnalyzer implements ShoppingContextAnalyzer {
  async analyze(input: ShoppingContextAnalysisInput): Promise<ShoppingContext> {
    const { source, productUnderstanding: pu } = input;

    const rawTitle = (source.title || "").toLowerCase();
    const rawNiche = (source.niche || "").toLowerCase();
    const rawDescription = (source.description || "").toLowerCase();
    const rawHandle = (source.handle || "").replace(/[-_]/g, " ").toLowerCase();
    const rawCategory = (pu?.physicalProductIdentity || "").toLowerCase();
    const rawStyle = (pu?.typography.styleSummary || "").toLowerCase();
    const ocrTokens = (pu?.typography.visibleTexts || []).map((t) => t.toLowerCase());
    const entities = pu?.visualEntities && pu.visualEntities !== "unknown" ? [pu.visualEntities.toLowerCase()] : [];

    const allSignalsText = [
      rawTitle,
      rawNiche,
      rawDescription,
      rawHandle,
      rawCategory,
      rawStyle,
      ...ocrTokens,
      ...entities,
    ].join(" ");

    // 1. Resolve Category
    let categoryRule = DEFAULT_CATEGORY_RULE;
    let matchedCategoryKey: string | undefined;

    if (rawCategory && CATEGORY_RULES[rawCategory]) {
      categoryRule = CATEGORY_RULES[rawCategory];
      matchedCategoryKey = rawCategory;
    } else {
      for (const [catKey, rule] of Object.entries(CATEGORY_RULES)) {
        const regex = new RegExp(`\\b${catKey}\\b`, "i");
        if (
          regex.test(rawCategory) ||
          regex.test(rawTitle) ||
          regex.test(rawNiche)
        ) {
          categoryRule = rule;
          matchedCategoryKey = catKey;
          break;
        }
      }
    }
    const categoryNoun = categoryRule.defaultCategoryNoun;

    // 2. Resolve Role / Recipient signals (from OCR, title, niche, entities)
    let detectedRole: typeof ROLE_RECIPIENT_RULES[string] | undefined;
    for (const [roleKey, roleDef] of Object.entries(ROLE_RECIPIENT_RULES)) {
      const regex = new RegExp(`\\b${roleKey}\\b`, "i");
      if (
        ocrTokens.some((ocr) => regex.test(ocr)) ||
        regex.test(rawTitle) ||
        regex.test(rawNiche) ||
        entities.some((e) => regex.test(e))
      ) {
        detectedRole = roleDef;
        break;
      }
    }

    // 3. Resolve Entity Audiences
    const matchedAudiencesFromEntities: string[] = [];
    let primaryEntity: string | undefined;

    // Check entities from B1 first
    for (const entity of entities) {
      if (ENTITY_AUDIENCE_ALLOWLIST[entity]) {
        matchedAudiencesFromEntities.push(ENTITY_AUDIENCE_ALLOWLIST[entity]);
        if (!primaryEntity) primaryEntity = entity;
      } else {
        // Check partial word match
        for (const [allowKey, audValue] of Object.entries(ENTITY_AUDIENCE_ALLOWLIST)) {
          if (entity.includes(allowKey)) {
            matchedAudiencesFromEntities.push(audValue);
            if (!primaryEntity) primaryEntity = allowKey;
            break;
          }
        }
      }
    }

    // If no entity from B1 matched allowlist, check title & niche
    if (!primaryEntity) {
      for (const [allowKey, audValue] of Object.entries(ENTITY_AUDIENCE_ALLOWLIST)) {
        const regex = new RegExp(`\\b${allowKey}\\b`, "i");
        if (regex.test(rawTitle) || regex.test(rawNiche)) {
          matchedAudiencesFromEntities.push(audValue);
          primaryEntity = allowKey;
          break;
        }
      }
    }

    // If still no allowlist entity, fall back to first detected entity from B1 for keywords
    if (!primaryEntity && entities.length > 0) {
      primaryEntity = entities[0];
    }

    // 4. Resolve Style
    let matchedStyleAudience: string | undefined;
    let primaryStyleWord: string | undefined;

    for (const [styleKey, styleAudience] of Object.entries(STYLE_RULES)) {
      const regex = new RegExp(`\\b${styleKey}\\b`, "i");
      if (regex.test(rawStyle) || regex.test(rawTitle)) {
        matchedStyleAudience = styleAudience;
        primaryStyleWord = styleKey;
        break;
      }
    }

    // 5. Resolve Occasions
    const matchedOccasions: string[] = [];
    let primaryOccasionWord: string | undefined;

    for (const [occKey, occValues] of Object.entries(OCCASION_RULES)) {
      const regex = new RegExp(`\\b${occKey}\\b`, "i");
      if (
        ocrTokens.some((ocr) => regex.test(ocr)) ||
        regex.test(rawTitle) ||
        regex.test(rawNiche) ||
        regex.test(rawDescription) ||
        entities.some((e) => regex.test(e))
      ) {
        matchedOccasions.push(...occValues);
        if (!primaryOccasionWord) primaryOccasionWord = occKey;
      }
    }

    if (detectedRole) {
      matchedOccasions.push(detectedRole.occasion);
    }

    // 6. Check Personalization signal
    const isPersonalized = PERSONALIZATION_SIGNALS.some((sig) => {
      const regex = new RegExp(`\\b${sig}\\b`, "i");
      return regex.test(allSignalsText);
    });

    // 7. Compose targetAudience (1 - 8)
    const rawAudiences: string[] = [];
    if (detectedRole) {
      rawAudiences.push(...detectedRole.audiences);
    }
    rawAudiences.push(...matchedAudiencesFromEntities);
    if (matchedStyleAudience) {
      rawAudiences.push(matchedStyleAudience);
    }
    rawAudiences.push(...categoryRule.audiences);

    let targetAudience = deduplicateAndNormalizeList(rawAudiences);
    if (targetAudience.length === 0) {
      targetAudience = ["general shoppers"];
    }
    if (targetAudience.length > 8) {
      targetAudience = targetAudience.slice(0, 8);
    }

    // 8. Compose suitableOccasions (1 - 6)
    const rawOccasions = [...matchedOccasions, ...categoryRule.occasions];
    let suitableOccasions = deduplicateAndNormalizeList(rawOccasions);
    if (suitableOccasions.length === 0) {
      suitableOccasions = ["everyday use"];
    }
    if (suitableOccasions.length > 6) {
      suitableOccasions = suitableOccasions.slice(0, 6);
    }

    // 9. Compose useCases (1 - 6)
    const rawUseCases = [...categoryRule.useCases];
    if (primaryOccasionWord === "halloween") {
      rawUseCases.push("costume party wear");
    }
    let useCases = deduplicateAndNormalizeList(rawUseCases);
    if (useCases.length === 0) {
      useCases = ["personal use"];
    }
    if (useCases.length > 6) {
      useCases = useCases.slice(0, 6);
    }

    // 10. Construct buyerIntentKeywords
    const rawKeywords: string[] = [];

    // Canonicalize style word for search phrases (e.g. "vintage retro" -> "vintage")
    let simplifiedStyle = primaryStyleWord;
    if (simplifiedStyle === "vintage retro") {
      simplifiedStyle = "vintage";
    }

    // Canonicalize audience singular for gift phrases (e.g. "cat lovers" -> "cat lover")
    const primaryAudience = matchedAudiencesFromEntities[0];
    let primaryAudienceSingular: string | undefined;
    if (primaryAudience) {
      primaryAudienceSingular = primaryAudience.endsWith("s")
        ? primaryAudience.slice(0, -1)
        : primaryAudience;
    } else if (primaryEntity && ENTITY_AUDIENCE_ALLOWLIST[primaryEntity]) {
      primaryAudienceSingular = `${primaryEntity} lover`;
    }

    if (categoryNoun === "product") {
      // When category is unknown/unspecified
      if (entities.length > 0) {
        rawKeywords.push(...entities.slice(0, 5));
      } else if (rawNiche) {
        rawKeywords.push(rawNiche);
      } else if (rawTitle) {
        rawKeywords.push(rawTitle);
      } else {
        rawKeywords.push("general merchandise");
      }
    } else {
      // Axis 1: Style + Entity + Category
      if (simplifiedStyle && primaryEntity) {
        rawKeywords.push(`${simplifiedStyle} ${primaryEntity} ${categoryNoun}`);
      }

      // Axis 2: Entity + Occasion + Category
      if (primaryEntity && primaryOccasionWord) {
        rawKeywords.push(`${primaryEntity} ${primaryOccasionWord} ${categoryNoun}`);
      }

      // Axis 3: Occasion + Category
      if (primaryOccasionWord) {
        rawKeywords.push(`${primaryOccasionWord} ${categoryNoun}`);
      }

      // Axis 4: Entity + Category
      if (primaryEntity) {
        rawKeywords.push(`${primaryEntity} ${categoryNoun}`);
      }

      // Axis 5: Category for Audience
      if (primaryAudience) {
        rawKeywords.push(`${categoryNoun} for ${primaryAudience}`);
      } else if (primaryEntity && ENTITY_AUDIENCE_ALLOWLIST[primaryEntity]) {
        rawKeywords.push(`${categoryNoun} for ${primaryEntity} lovers`);
      }

      // Axis 6: Role / Gift keywords
      if (detectedRole) {
        rawKeywords.push(`${detectedRole.roleKeyword} ${categoryNoun}`);
        rawKeywords.push(`${detectedRole.giftKeyword}`);
        rawKeywords.push(`${categoryNoun} ${detectedRole.giftKeyword}`);
      } else if (primaryAudienceSingular) {
        rawKeywords.push(`gift for ${primaryAudienceSingular}`);
        rawKeywords.push(`${categoryNoun} gift for ${primaryAudienceSingular}`);
      }

      // Axis 7: Personalization (only if supported)
      if (isPersonalized) {
        if (primaryEntity) {
          rawKeywords.push(`personalized ${primaryEntity} ${categoryNoun}`);
        }
        rawKeywords.push(`custom ${categoryNoun}`);
      }

      // Axis 8: Style + Category
      if (simplifiedStyle) {
        rawKeywords.push(`${simplifiedStyle} ${categoryNoun}`);
      }

      // Axis 9: Niche + Category (if distinct)
      if (rawNiche && rawNiche !== primaryEntity && !rawKeywords.some((k) => k.includes(rawNiche))) {
        rawKeywords.push(`${rawNiche} ${categoryNoun}`);
      }
    }

    let buyerIntentKeywords = deduplicateAndNormalizeList(rawKeywords, true);

    // Ensure at least 1 keyword contains categoryNoun when category is known
    if (
      categoryNoun !== "product" &&
      buyerIntentKeywords.length > 0 &&
      !buyerIntentKeywords.some((k) => k.includes(categoryNoun))
    ) {
      buyerIntentKeywords.unshift(categoryNoun);
    }

    // Selective Backfill: Generic category fallback seeds ONLY run when specific intent candidates < 3
    if (categoryNoun !== "product" && buyerIntentKeywords.length < 3) {
      const genericFallbacks = [
        `casual ${categoryNoun}`,
        `everyday ${categoryNoun}`,
        categoryNoun,
      ];
      for (const fallbackSeed of genericFallbacks) {
        if (buyerIntentKeywords.length >= 3) break;
        if (!buyerIntentKeywords.includes(fallbackSeed)) {
          buyerIntentKeywords.push(fallbackSeed);
        }
      }
      buyerIntentKeywords = deduplicateAndNormalizeList(buyerIntentKeywords, true);
    }

    if (buyerIntentKeywords.length > 12) {
      buyerIntentKeywords = buyerIntentKeywords.slice(0, 12);
    }

    return {
      targetAudience,
      suitableOccasions,
      useCases,
      buyerIntentKeywords,
    };
  }
}


export const heuristicShoppingContextAnalyzer = new HeuristicShoppingContextAnalyzer();
