import type { SeoProductUiViewModel, ZoomImageItem } from "./types";

/**
 * Builds a list of zoomable image items from a product's gallery.
 */
export function buildProductZoomImages(
  product: SeoProductUiViewModel | null | undefined,
): readonly ZoomImageItem[] {
  if (!product || !product.images) {
    return [];
  }

  const items: ZoomImageItem[] = [];

  for (const img of product.images) {
    const url = img.previewUrl?.value || img.webpUrl?.value || "";
    if (url.trim()) {
      items.push({
        url,
        altText: img.alt?.value || "",
        title: product.productTitle?.value || "Ảnh sản phẩm",
      });
    }
  }

  return items;
}
