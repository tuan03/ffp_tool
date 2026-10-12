import type { StoreProductTitleIdentity } from "./types";

const VISUAL_ONLY_SUFFIX_PATTERN =
  /\s+(?:artwork|art|design|pattern|illustration|image)(?:\s+(?:collection|piece))?\s*$/i;
const COMMERCE_SUFFIX_PATTERN =
  /\s*(?:\||[-–—])\s*(?:shop(?:\s+online)?|buy(?:\s+online)?|order(?:\s+now)?|official\s+store|quality\s*&\s*style)(?:\s+now|\s+today)?\s*$/i;

function identityPattern(term: string): RegExp {
  const tokens = term.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const body = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s-]+");
  return new RegExp(`(^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, "i");
}

function cleanTitlePunctuation(value: string): string {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|•:,]\s*$/, "")
    .replace(/^\s*[-–—|•:,]\s*/, "")
    .trim();
}

function fitBaseWithIdentity(base: string, identity: string, maxLength?: number): string {
  const suffix = base ? ` ${identity}` : identity;
  if (!maxLength || `${base}${base ? " " : ""}${identity}`.length <= maxLength) {
    return `${base}${base ? " " : ""}${identity}`.trim();
  }

  const availableLength = Math.max(0, maxLength - suffix.length);
  const words: string[] = [];
  let usedLength = 0;
  for (const word of base.split(/\s+/)) {
    const addedLength = words.length === 0 ? word.length : word.length + 1;
    if (usedLength + addedLength > availableLength) break;
    words.push(word);
    usedLength += addedLength;
  }
  return `${words.join(" ")}${words.length > 0 ? " " : ""}${identity}`.trim();
}

export function toProductIdentityTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function hasProductIdentityInTitle(
  title: string,
  identity: StoreProductTitleIdentity,
): boolean {
  return identity.acceptedTerms.some((term) =>
    term.trim().length > 0 && identityPattern(term).test(title),
  );
}

export function ensureProductIdentityInTitle(
  rawTitle: string,
  identity: StoreProductTitleIdentity,
  maxLength?: number,
): string {
  const original = cleanTitlePunctuation(rawTitle);
  if (!original) return identity.preferredTerm;
  if (hasProductIdentityInTitle(original, identity) && (!maxLength || original.length <= maxLength)) {
    return original;
  }

  let base = original;
  for (const acceptedTerm of identity.acceptedTerms) {
    if (!acceptedTerm.trim()) continue;
    base = base.replace(identityPattern(acceptedTerm), "$1");
  }
  base = cleanTitlePunctuation(base.replace(COMMERCE_SUFFIX_PATTERN, ""));
  base = cleanTitlePunctuation(base.replace(VISUAL_ONLY_SUFFIX_PATTERN, ""));

  return fitBaseWithIdentity(base, identity.preferredTerm, maxLength);
}
