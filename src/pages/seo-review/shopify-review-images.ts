import type { SeoImageUiViewModel } from "./types";

function imageUrlKey(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "cdn.shopify.com") {
      for (const key of ["width", "height", "crop", "format"]) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return value;
  }
}

/** Match only within the source product; never infer a media ID from list position. */
export function restoreShopifyReviewImageIds(
  images: readonly SeoImageUiViewModel[],
  sourceImages: readonly unknown[] = [],
): readonly SeoImageUiViewModel[] {
  const idsByUrl = new Map<string, Set<string>>();
  for (const source of sourceImages) {
    if (!source || typeof source !== "object" || !("id" in source) || typeof source.id !== "string" ||
      !/^gid:\/\/shopify\/MediaImage\/\d+$/.test(source.id)) continue;
    const url = "url" in source && typeof source.url === "string" ? source.url
      : "src" in source && typeof source.src === "string" ? source.src : undefined;
    if (!url) continue;
    const key = imageUrlKey(url);
    const ids = idsByUrl.get(key) ?? new Set<string>();
    ids.add(source.id);
    idsByUrl.set(key, ids);
  }
  return images.map(image => {
    if (/^gid:\/\/shopify\/MediaImage\/\d+$/.test(image.id)) return image;
    const ids = idsByUrl.get(imageUrlKey(image.previewUrl.value));
    if (ids?.size !== 1) return image;
    const id = ids.values().next().value;
    return typeof id === "string" ? { ...image, id } : image;
  });
}
