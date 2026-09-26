import { cleanSlug } from "../content-generation/slug-utils";

function getBasename(filePathOrName: string): string {
  const parts = filePathOrName.split(/[/\\]/);
  return parts[parts.length - 1] || filePathOrName;
}

export interface WebpFilenameOptions {
  readonly productHandle?: string;
  readonly productTitle?: string;
  readonly primaryKeyword?: string;
  readonly index: number;
}

/**
 * Generates an SEO-friendly, path-safe WebP filename following the naming convention:
 * `${stem}-${index + 1}.webp`
 *
 * Priority for filename stem:
 * 1. productHandle (if valid and not fallback "product")
 * 2. primaryKeyword (if provided)
 * 3. productTitle (if provided)
 * 4. Fallback: "product-image"
 */
export function generateWebpFilename(options: WebpFilenameOptions): string {
  const { productHandle, productTitle, primaryKeyword, index } = options;

  let stem = "";
  if (productHandle && productHandle.trim().length > 0) {
    const raw = getBasename(productHandle.trim());
    const slug = cleanSlug(raw, 80);
    if (slug && slug !== "product") {
      stem = slug;
    }
  }

  if (!stem && primaryKeyword && primaryKeyword.trim().length > 0) {
    const raw = getBasename(primaryKeyword.trim());
    const slug = cleanSlug(raw, 80);
    if (slug && slug !== "product") {
      stem = slug;
    }
  }

  if (!stem && productTitle && productTitle.trim().length > 0) {
    const raw = getBasename(productTitle.trim());
    const slug = cleanSlug(raw, 80);
    if (slug && slug !== "product") {
      stem = slug;
    }
  }

  if (!stem) {
    stem = "product-image";
  }

  // Ensure stem is safe from path traversal: extract basename and sanitize
  const safeStem =
    getBasename(stem)
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "product-image";

  return `${safeStem}-${index + 1}.webp`;
}
