import { characterLength } from "./alt-text-sanitizer";

/**
 * Fits alt text safely to a maximum character length (default 125 chars)
 * using word-safe truncation and trimming trailing punctuation.
 */
export function fitAltText(text: string, maxLength: number = 125): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (characterLength(cleaned) <= maxLength) {
    return cleaned;
  }

  // Word-safe truncation
  const words = cleaned.split(" ");
  const selected: string[] = [];

  for (const word of words) {
    const candidate = selected.length === 0 ? word : `${selected.join(" ")} ${word}`;
    if (characterLength(candidate) <= maxLength) {
      selected.push(word);
    } else {
      break;
    }
  }

  if (selected.length > 0) {
    let result = selected.join(" ");
    result = result.replace(/[,;:\-\s]+$/, "");
    return result;
  }

  // If even a single word is longer than maxLength, truncate character-safely
  const chars = Array.from(cleaned);
  return chars.slice(0, maxLength).join("").replace(/[,;:\-\s]+$/, "");
}
