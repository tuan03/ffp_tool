/**
 * Contextual conflict evaluator for gray-zone semantic similarity (0.86 <= similarity < 0.90).
 *
 * Distinguishes between:
 * - Same category + same theme/intent -> CONFLICT (cannibalization of existing catalog target)
 * - Materially different search intent / category -> KEEP (approved, no cannibalization)
 */
export interface ContextualConflictParams {
  readonly candidateKeyword: string;
  readonly candidateCategory?: string;
  readonly candidateTitle?: string;
  readonly catalogTitle?: string;
  readonly catalogKeyword: string;
}

export function checkContextualConflict(params: ContextualConflictParams): boolean {
  const { candidateKeyword, candidateCategory, candidateTitle, catalogTitle, catalogKeyword } = params;

  const candCatNorm = (candidateCategory ?? "").toLowerCase().trim();
  const candTitleNorm = (candidateTitle ?? "").toLowerCase().trim();
  const candKwNorm = candidateKeyword.toLowerCase().trim();
  const catTitleNorm = (catalogTitle ?? "").toLowerCase().trim();
  const catKwNorm = catalogKeyword.toLowerCase().trim();

  // Distinct category tokens: accessories vs apparel/rugs/home decor
  const accessoryTokens = ["pin", "badge", "keychain", "sticker", "poster", "mug", "cup", "phone case"];
  const apparelRugTokens = ["rug", "carpet", "mat", "blanket", "shirt", "t-shirt", "tee", "hoodie", "apparel"];

  const candHasAccessory = accessoryTokens.some(
    (t) => candCatNorm.includes(t) || candTitleNorm.includes(t) || candKwNorm.includes(t),
  );
  const catHasApparelRug = apparelRugTokens.some(
    (t) => catTitleNorm.includes(t) || catKwNorm.includes(t),
  );

  const candHasApparelRug = apparelRugTokens.some(
    (t) => candCatNorm.includes(t) || candTitleNorm.includes(t) || candKwNorm.includes(t),
  );
  const catHasAccessory = accessoryTokens.some(
    (t) => catTitleNorm.includes(t) || catKwNorm.includes(t),
  );

  // If one is an accessory and the other is a rug/apparel, materially different search intent -> NOT a conflict!
  if ((candHasAccessory && catHasApparelRug) || (candHasApparelRug && catHasAccessory)) {
    return false;
  }

  // Token overlap on topic / category / intent
  const stopWords = new Set(["for", "and", "the", "with", "custom", "personalized", "a", "an", "in", "of"]);
  const candTokens = new Set(
    `${candCatNorm} ${candTitleNorm} ${candKwNorm}`
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !stopWords.has(t)),
  );
  const catTokens = new Set(
    `${catTitleNorm} ${catKwNorm}`
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !stopWords.has(t)),
  );

  let sharedCount = 0;
  for (const token of candTokens) {
    if (catTokens.has(token)) {
      sharedCount++;
    }
  }

  return sharedCount >= 1;
}
