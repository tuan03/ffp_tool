import type { AutoSeoProductCandidate } from "./types";

export function mapShopifyProductToAutoSeoCandidate(product: {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  seo?: {
    title?: string | null;
    description?: string | null;
  };
  images?: readonly {
    url: string;
    altText?: string | null;
  }[];
}): AutoSeoProductCandidate {
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? "",
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
    images: (product.images ?? []).map((image, index) => ({
      url: image.url,
      altText: image.altText ?? undefined,
      position: index + 1,
    })),
  };
}
