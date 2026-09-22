/**
 * Cleans and transforms a text string into a URL-safe, SEO-friendly slug.
 */
export function cleanSlug(text: string, maxLength: number = 80): string {
  if (!text || typeof text !== "string") {
    return "product";
  }

  // 1. Normalize unicode and strip diacritical marks (accents)
  let slug = text
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 2. Replace non-alphanumeric characters with hyphens
  slug = slug.replace(/[^a-z0-9]+/g, "-");

  // 3. Collapse multiple consecutive hyphens
  slug = slug.replace(/-+/g, "-");

  // 4. Trim leading and trailing hyphens
  slug = slug.replace(/^-+|-+$/g, "");

  if (!slug) {
    return "product";
  }

  // 5. Length ceiling without cutting tokens in half
  if (slug.length > maxLength) {
    const tokens = slug.split("-");
    const selected: string[] = [];
    let currentLength = 0;

    for (const token of tokens) {
      const addedLength = selected.length === 0 ? token.length : token.length + 1;
      if (currentLength + addedLength <= maxLength) {
        selected.push(token);
        currentLength += addedLength;
      } else {
        break;
      }
    }

    if (selected.length > 0) {
      slug = selected.join("-");
    } else {
      slug = slug.slice(0, maxLength).replace(/-+$/, "");
    }
  }

  return slug || "product";
}

export interface SlugGenerationOptions {
  readonly existingHandle?: string;
  readonly preserveExisting?: boolean;
  readonly maxLength?: number;
}

/**
 * Generates or preserves a product handle.
 * If preserveExisting is true (default) and existingHandle is present, preserves it.
 * Otherwise, generates an optimized slug from the primary keyword or title.
 */
export function generateProductHandle(
  primaryOrTitle: string,
  options: SlugGenerationOptions = {},
): string {
  const {
    existingHandle,
    preserveExisting = true,
    maxLength = 80,
  } = options;

  if (preserveExisting && existingHandle && existingHandle.trim().length > 0) {
    return cleanSlug(existingHandle, maxLength);
  }

  return cleanSlug(primaryOrTitle, maxLength);
}
