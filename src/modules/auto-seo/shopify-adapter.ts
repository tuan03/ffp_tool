import type { AutoSeoProductCandidate } from "./types";

export function mapShopifyProductToAutoSeoCandidate(product: {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  images?: readonly {
    url: string;
    altText?: string;
  }[];
}): AutoSeoProductCandidate {
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? "",
    images: (product.images ?? []).map((image, index) => ({
      url: image.url,
      altText: image.altText,
      position: index + 1,
    })),
  };
}
