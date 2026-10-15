/** Exact child identities only. Parent aliases never reserve every sibling. */
export function getAmazonPipelineAsins(snapshot: unknown): readonly string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const product = snapshot as Record<string, unknown>;
  const normalize = (value: unknown): string => typeof value === "string" ? value.trim().toUpperCase() : "";
  const primary = normalize(product.asin);
  const parent = normalize(product.parentAsin);
  const variants = Array.isArray(product.sourceVariants) ? product.sourceVariants : [];
  const asins = variants.map((variant: unknown) => normalize(
    variant && typeof variant === "object" && "asin" in variant ? variant.asin : variant,
  )).filter(asin => /^[A-Z0-9]{10}$/.test(asin) && asin !== parent);
  if (/^[A-Z0-9]{10}$/.test(primary)) asins.push(primary);
  return [...new Set(asins)];
}
