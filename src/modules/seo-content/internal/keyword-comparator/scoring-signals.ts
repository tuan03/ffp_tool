import type { KeywordEvaluationContext } from "./types";

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "of", "and", "or", "for", "with", "to", "at", "by", "from",
]);

/**
 * Normalizes text for keyword token analysis.
 */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Splits text into significant tokens excluding common stopwords.
 */
export function extractSignificantTokens(text: string): string[] {
  const norm = normalizeKeyword(text);
  return norm
    .split(/[\s-]+/)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 1 && !STOPWORDS.has(tok));
}

/**
 * Known product categories and synonyms for entity alignment & category clash detection.
 */
const CATEGORY_MAP: Record<string, { synonyms: readonly string[]; clashes: readonly string[] }> = {
  rug: {
    synonyms: ["rug", "carpet", "mat", "runner", "area rug", "floor mat", "carpeting"],
    clashes: ["blanket", "shirt", "t-shirt", "tee", "mug", "cup", "hoodie", "curtain", "pillow"],
  },
  "t-shirt": {
    synonyms: ["shirt", "t-shirt", "tee", "tshirt", "top", "apparel", "clothing"],
    clashes: ["rug", "carpet", "mat", "blanket", "quilt", "bedding", "mug", "tumbler"],
  },
  shirt: {
    synonyms: ["shirt", "t-shirt", "tee", "tshirt", "top", "apparel"],
    clashes: ["rug", "carpet", "mat", "blanket", "quilt", "bedding", "mug"],
  },
  quilt: {
    synonyms: ["quilt", "bedding", "bedspread", "comforter", "duvet", "blanket", "coverlet"],
    clashes: ["rug", "mat", "shirt", "tee", "mug", "tumbler", "curtain"],
  },
  bedding: {
    synonyms: ["bedding", "quilt", "bedspread", "comforter", "duvet", "sheets", "pillowcases"],
    clashes: ["rug", "mat", "shirt", "tee", "mug", "tumbler"],
  },
  mug: {
    synonyms: ["mug", "cup", "tumbler", "coffee cup", "coffee mug", "drinkware"],
    clashes: ["shirt", "tee", "rug", "quilt", "blanket", "bedding"],
  },
  hoodie: {
    synonyms: ["hoodie", "sweatshirt", "pullover", "sweater", "apparel"],
    clashes: ["rug", "carpet", "mat", "mug", "quilt", "bedding"],
  },
};

/**
 * Signal 1: Entity Alignment (35% weight)
 * Evaluates how well the keyword matches:
 * 1. Physical product identity (Stage B1)
 * 2. Visual entities and visible OCR texts (Stage B1)
 * Penalizes category mismatches and clashes.
 */
export function calculateEntityAlignment(
  keyword: string,
  context: KeywordEvaluationContext,
): number {
  const normKw = normalizeKeyword(keyword);
  const kwTokens = extractSignificantTokens(keyword);

  if (kwTokens.length === 0) return 0.0;

  const physicalId = context.physicalProductIdentity ? normalizeKeyword(context.physicalProductIdentity) : "";
  const idTokens = context.physicalProductIdentity ? extractSignificantTokens(context.physicalProductIdentity) : [];

  // Check category clash / mismatch
  for (const [catKey, catInfo] of Object.entries(CATEGORY_MAP)) {
    const isCategoryOfProduct = physicalId.includes(catKey) || idTokens.some((tok) => catInfo.synonyms.includes(tok));
    if (isCategoryOfProduct) {
      for (const clashToken of catInfo.clashes) {
        if (kwTokens.includes(clashToken)) {
          // Direct competing product category in keyword -> immediate 0.0
          return 0.0;
        }
      }
    }
  }

  // 1. Physical Identity Score (0.0 to 1.0)
  let identityScore = 0.15;
  if (physicalId && normKw.includes(physicalId)) {
    identityScore = 1.0;
  } else if (idTokens.length > 0) {
    const matchingIdTokens = idTokens.filter((tok) => kwTokens.includes(tok));
    if (matchingIdTokens.length === idTokens.length) {
      identityScore = 0.95;
    } else if (matchingIdTokens.length > 0) {
      identityScore = 0.70 + 0.20 * (matchingIdTokens.length / idTokens.length);
    } else {
      // Check for category synonyms
      for (const catInfo of Object.values(CATEGORY_MAP)) {
        const matchesCategory = idTokens.some((tok) => catInfo.synonyms.includes(tok));
        if (matchesCategory) {
          const hasSynonym = catInfo.synonyms.some((syn) => normKw.includes(syn));
          if (hasSynonym) {
            identityScore = 0.55;
            break;
          }
        }
      }
    }
  }

  // 2. Visual Entities & Visible Texts Score (0.0 to 1.0)
  const visualText = [
    context.visualEntities ?? "",
    ...(context.visibleTexts ?? []),
  ].join(" ").trim();

  let visualScore = 1.0;
  if (visualText) {
    const visualTokens = extractSignificantTokens(visualText);
    if (visualTokens.length > 0) {
      const matchingVisualTokens = visualTokens.filter((tok) => kwTokens.includes(tok));
      const visualRatio = matchingVisualTokens.length / Math.min(visualTokens.length, 4);
      if (matchingVisualTokens.length >= 2 || visualRatio >= 0.5) {
        visualScore = 1.0;
      } else if (matchingVisualTokens.length === 1) {
        visualScore = 0.75;
      } else {
        visualScore = 0.25;
      }
    }
  }

  // Combine identity and visual scores
  let combined: number;
  if (visualText) {
    if (identityScore >= 0.70 && visualScore >= 0.75) {
      // High synergy: contains both identity and visual entity
      combined = Math.min(1.0, 0.55 * identityScore + 0.45 * visualScore + 0.05);
    } else if (identityScore <= 0.20) {
      // Visual entity without product identity cannot be a high-quality primary keyword
      combined = Math.min(0.35, visualScore * 0.4);
    } else {
      combined = 0.60 * identityScore + 0.40 * visualScore;
    }
  } else {
    combined = identityScore;
  }

  return Number(Math.max(0.0, Math.min(1.0, combined)).toFixed(4));
}

/**
 * Informational / non-commercial query patterns that must be penalized for e-commerce primary keywords.
 */
const INFORMATIONAL_PATTERNS: readonly RegExp[] = [
  /\bhow\s+to\b/i,
  /\bhow\s+do\b/i,
  /\bdiy\b/i,
  /\bfree\b/i,
  /\btutorial\b/i,
  /\bguide\b/i,
  /\bwhat\s+is\b/i,
  /\bmeaning\s+of\b/i,
  /\bcare\s+for\b/i,
  /\bdrawing\b/i,
  /\bhistory\s+of\b/i,
  /\bpatterns?\b/i,
  /\bdownload\b/i,
  /\btemplates?\b/i,
  /\bpdf\b/i,
  /\bcoloring\b/i,
  /\bclipart\b/i,
  /\bquotes?\b/i,
];

/**
 * Commercial, transactional, and gift modifiers.
 */
const COMMERCIAL_MODIFIERS = new Set([
  "custom", "personalized", "personalize", "handmade", "printed", "engraved", "bespoke",
  "gift", "gifts", "present", "decor", "decoration", "set", "pack", "collection",
  "buy", "shop", "order", "store", "sale",
]);

/**
 * Signal 2: Buyer & Commercial Intent (25% weight)
 * Scores transactional, gift, occasion qualifiers, buyer intent keywords from Stage B2,
 * and penalizes purely informational/educational queries.
 */
export function calculateCommercialIntent(
  keyword: string,
  context: KeywordEvaluationContext,
): number {
  const normKw = normalizeKeyword(keyword);

  // Check for informational / DIY modifiers -> hard penalty to 0.0
  for (const pattern of INFORMATIONAL_PATTERNS) {
    if (pattern.test(normKw)) {
      return 0.0;
    }
  }

  const kwTokens = extractSignificantTokens(keyword);
  if (kwTokens.length === 0) return 0.0;

  // Base commercial product query baseline
  let score = 0.55;

  // 1. Transactional & Commercial qualifiers
  const hasCommercialModifier = kwTokens.some((tok) => COMMERCIAL_MODIFIERS.has(tok));
  if (hasCommercialModifier) {
    score += 0.25;
  }

  // 2. Audience qualifiers from context
  if (context.targetAudience && context.targetAudience.length > 0) {
    const audienceTokens = context.targetAudience.flatMap(extractSignificantTokens);
    if (kwTokens.some((tok) => audienceTokens.includes(tok))) {
      score += 0.15;
    }
  }

  // 3. Occasion qualifiers from context
  if (context.occasions && context.occasions.length > 0) {
    const occasionTokens = context.occasions.flatMap(extractSignificantTokens);
    if (kwTokens.some((tok) => occasionTokens.includes(tok))) {
      score += 0.15;
    }
  }

  // 4. Buyer Intent Keywords from Stage B2
  if (context.buyerIntentKeywords && context.buyerIntentKeywords.length > 0) {
    const matchesBuyerIntent = context.buyerIntentKeywords.some((intentKw) => {
      const normIntent = normalizeKeyword(intentKw);
      return normKw.includes(normIntent) || normIntent.includes(normKw);
    });
    if (matchesBuyerIntent) {
      score += 0.20;
    }
  }

  // Penalize overly generic single-word keywords
  if (kwTokens.length === 1 && !hasCommercialModifier) {
    score = Math.min(score, 0.40);
  }

  return Number(Math.max(0.0, Math.min(1.0, score)).toFixed(4));
}

/**
 * Signal 3: Search Validation (25% weight)
 * Validates against Google Suggest queries:
 * - Exact match = 1.0
 * - Prefix/contains match = 0.7
 * - Unverified = 0.2
 *
 * Strictly NO external paid volume APIs. All search validation derives solely from internal signals.
 */
export function calculateSearchValidation(
  keyword: string,
  suggestions: readonly string[] = [],
): number {
  if (suggestions.length === 0) {
    return 0.2; // Unverified
  }

  const normKw = normalizeKeyword(keyword);
  if (!normKw) return 0.2;

  // Check exact match
  for (const suggestion of suggestions) {
    const normSug = normalizeKeyword(suggestion);
    if (normKw === normSug) {
      return 1.0;
    }
  }

  // Check prefix or contains match
  for (const suggestion of suggestions) {
    const normSug = normalizeKeyword(suggestion);
    if (!normSug) continue;

    if (
      normSug.startsWith(normKw) ||
      normKw.startsWith(normSug) ||
      normSug.includes(normKw) ||
      normKw.includes(normSug)
    ) {
      return 0.7;
    }
  }

  // Unverified query
  return 0.2;
}

export interface CannibalizationEvaluation {
  readonly score: number;
  readonly isHardVeto: boolean;
  readonly conflictReason?: string;
}

/**
 * Signal 4: Cannibalization Safety (15% weight + hard veto)
 * Checks conflict against catalog corpus from Stage B4.
 * Severe conflicts (exact match, primary keyword conflict) act as a hard veto (score = 0.0).
 */
export function calculateCannibalizationSafety(
  keyword: string,
  context: KeywordEvaluationContext,
): CannibalizationEvaluation {
  const normKw = normalizeKeyword(keyword);
  if (!normKw) {
    return { score: 1.0, isHardVeto: false };
  }

  // Check known discarded keywords & conflict details from Stage B4
  if (context.knownConflicts && context.knownConflicts.length > 0) {
    const isConflict = context.knownConflicts.some(
      (confKw) => normalizeKeyword(confKw) === normKw,
    );

    if (isConflict) {
      const detail = context.conflictDetails?.[keyword] ?? context.conflictDetails?.[normKw];
      const reason = detail?.reason?.toUpperCase() ?? "";

      // Check severe conflict types
      const isSevere =
        detail?.matchType === "exact" ||
        (detail?.similarity ?? 0) >= 0.90 ||
        reason.includes("EXACT_MATCH") ||
        reason.includes("CANNOT_OUTRANK") ||
        reason.includes("PRIMARY");

      if (isSevere) {
        return {
          score: 0.0,
          isHardVeto: true,
          conflictReason: detail?.reason || "Severe catalog conflict with existing primary keyword (hard veto)",
        };
      }

      // Secondary overlap / moderate conflict
      return {
        score: 0.50,
        isHardVeto: false,
        conflictReason: detail?.reason || "Moderate secondary overlap in catalog",
      };
    }
  }

  // Check existing targets from conflict corpus if provided
  if (context.existingTargets && context.existingTargets.length > 0) {
    for (const target of context.existingTargets) {
      // Exclude self-conflict if target product matches current product
      const isSelf =
        Boolean(context.productId && target.productId === context.productId) ||
        Boolean(context.handle && target.handle === context.handle);

      if (isSelf) continue;

      const normTargetKw = normalizeKeyword(target.keyword ?? target.primaryKeyword ?? "");
      if (normTargetKw === normKw) {
        return {
          score: 0.0,
          isHardVeto: true,
          conflictReason: `Exact match conflict with product '${target.title || target.productId || "catalog target"}' (hard veto)`,
        };
      }

      // Check semantic similarity only if target keyword relates to evaluated keyword
      if (normTargetKw && (normKw.includes(normTargetKw) || normTargetKw.includes(normKw))) {
        if (target.similarity !== undefined && target.similarity >= 0.90 && target.rank === 0) {
          return {
            score: 0.0,
            isHardVeto: true,
            conflictReason: `High semantic similarity (${target.similarity.toFixed(2)}) with primary keyword of '${target.title || target.productId}'`,
          };
        }

        if (target.similarity !== undefined && target.similarity >= 0.85) {
          return {
            score: 0.60,
            isHardVeto: false,
            conflictReason: `Moderate semantic similarity (${target.similarity.toFixed(2)}) with secondary keyword`,
          };
        }
      }
    }
  }

  // Clean / No conflict detected
  return {
    score: 1.0,
    isHardVeto: false,
  };
}
