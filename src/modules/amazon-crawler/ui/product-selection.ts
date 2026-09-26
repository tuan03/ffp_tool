import type { AmazonCrawlerProduct } from "../types";

export function resolveSelectedProduct(
  products: readonly AmazonCrawlerProduct[],
  selectedProductId: string | null,
): AmazonCrawlerProduct | null {
  return products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
}

export function firstProductMediaUrl(product: AmazonCrawlerProduct | null): string | null {
  if (product?.sourceVariants.some((variant) => variant.diagnostics?.fetchMode === "failed")) return null;
  return product?.media[0]?.url ?? null;
}
