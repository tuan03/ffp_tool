/**
 * Capitalizes the first letter of each significant word.
 */
export function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2 && /^(a|an|the|in|on|at|by|for|of|to)$/i.test(word)) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Fits and formats an SEO Title within the strict <= 70 character limit,
 * ensuring no words are sliced in half.
 */
export function fitSeoTitle(
  rawTitle: string,
  primaryKeyword?: string,
  maxLength: number = 70,
): string {
  const trimmed = rawTitle.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  // 1. Try stripping common pipe or dash suffixes
  const stripped = trimmed.replace(/\s*([|•\-–—:]\s*[^|•\-–—:]+)+$/, "").trim();
  if (stripped.length > 0 && stripped.length <= maxLength) {
    return stripped;
  }

  // 2. If primary keyword is available, build a tight title
  if (primaryKeyword && primaryKeyword.trim().length > 0) {
    const candidate = toTitleCase(primaryKeyword.trim());
    if (candidate.length <= maxLength) {
      return candidate;
    }
  }

  // 3. Clean word-boundary truncation
  const words = trimmed.split(/\s+/);
  const selected: string[] = [];
  let length = 0;

  for (const word of words) {
    const added = selected.length === 0 ? word.length : word.length + 1;
    if (length + added <= maxLength) {
      selected.push(word);
      length += added;
    } else {
      break;
    }
  }

  if (selected.length > 0) {
    return selected.join(" ");
  }

  return trimmed.slice(0, maxLength);
}

/**
 * Fits and formats a Meta Description within the strict <= 160 character limit,
 * preserving sentence or word boundaries without awkward truncation.
 */
export function fitSeoDescription(
  rawDescription: string,
  maxLength: number = 160,
): string {
  const clean = rawDescription.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  // 1. Try breaking at the last complete sentence ending before maxLength
  const sentenceMatch = clean.slice(0, maxLength).match(/^(.*[.!?])\s+[A-Z]/);
  if (sentenceMatch && sentenceMatch[1] && sentenceMatch[1].length >= 70) {
    return sentenceMatch[1].trim();
  }

  // 2. Break at the last word boundary before (maxLength - 3) and append '...'
  const targetLen = maxLength - 3;
  const words = clean.slice(0, targetLen).split(/\s+/);
  if (words.length > 1) {
    words.pop(); // drop potentially cut-off word
    return `${words.join(" ").trim()}...`;
  }

  return clean.slice(0, maxLength);
}

/**
 * Fits product title to a clean e-commerce standard (typically 45-80 chars).
 */
export function fitProductTitle(
  rawTitle: string,
  maxLength: number = 100,
): string {
  const trimmed = rawTitle.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/);
  const selected: string[] = [];
  let length = 0;

  for (const word of words) {
    const added = selected.length === 0 ? word.length : word.length + 1;
    if (length + added <= maxLength) {
      selected.push(word);
      length += added;
    } else {
      break;
    }
  }

  return selected.join(" ");
}
