/**
 * Strips forced bedding style list phrases (e.g. "Comforter, Quilt, Duvet Cover")
 * from product titles or SEO titles.
 *
 * Preserves the original artwork/design and variant details while adhering to the core
 * title invariant: titles must focus on the design and variant, NOT forced variant lists.
 */
export function sanitizeBeddingTitle(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== "string") {
    return "";
  }

  let cleaned = rawTitle;

  // Pattern matching variations of "Comforter, Quilt, Duvet Cover" with any order, separators, brackets, commas
  const FORCED_BEDDING_STYLES_PATTERN =
    /\s*[-–—|•:(,[\]]*\s*(?:available\s+in\s+)?(?:comforter\s*[,/&|]?\s*quilt\s*[,/&|]?\s*(?:and\s+|or\s+)?duvet\s+cover|comforter\s*[,/&|]?\s*duvet\s+cover\s*[,/&|]?\s*(?:and\s+|or\s+)?quilt|quilt\s*[,/&|]?\s*comforter\s*[,/&|]?\s*(?:and\s+|or\s+)?duvet\s+cover|quilt\s*[,/&|]?\s*duvet\s+cover\s*[,/&|]?\s*(?:and\s+|or\s+)?comforter|duvet\s+cover\s*[,/&|]?\s*comforter\s*[,/&|]?\s*(?:and\s+|or\s+)?quilt|duvet\s+cover\s*[,/&|]?\s*quilt\s*[,/&|]?\s*(?:and\s+|or\s+)?comforter)[\])]*/gi;

  cleaned = cleaned.replace(FORCED_BEDDING_STYLES_PATTERN, " ");

  // Clean intermediate punctuation artifacts like ", -" or "- ,"
  cleaned = cleaned
    .replace(/,\s*([-–—|•:])/g, " $1")
    .replace(/([-–—|•:])\s*,/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|•:,]\s*$/, "")
    .replace(/^\s*[-–—|•:,]\s*/, "")
    .trim();

  return cleaned || rawTitle.trim();
}
