export const MAX_QUERY_LENGTH = 120;
export const MAX_QUERY_TOKENS = 12;
export const MAX_PER_SEED_SUGGESTIONS = 8;
export const MAX_GLOBAL_SUGGESTIONS = 40;

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F]/;
const URL_ONLY_REGEX = /^(?:https?:\/\/|www\.)[^\s]+$/i;

/**
 * Normalizes a single suggestion string:
 * - Unicode NFKC normalization
 * - Collapses consecutive whitespace and trims
 * - Rejects empty, control characters, URL-only strings, excessive length/token counts
 * Returns cleaned string if valid, or undefined if rejected.
 */
export function normalizeSuggestionQuery(rawQuery: string): string | undefined {
  if (typeof rawQuery !== "string") {
    return undefined;
  }

  const normalized = rawQuery.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  if (CONTROL_CHARS_REGEX.test(normalized)) {
    return undefined;
  }

  if (URL_ONLY_REGEX.test(normalized)) {
    return undefined;
  }

  if (normalized.length > MAX_QUERY_LENGTH) {
    return undefined;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > MAX_QUERY_TOKENS) {
    return undefined;
  }

  return normalized;
}

export function canonicalKey(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
