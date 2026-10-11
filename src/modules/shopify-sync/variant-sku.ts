import type { ShopifyVariantInput } from "./types";

interface AmazonVariantSkuSource {
  readonly asin?: string;
  readonly variant: ShopifyVariantInput;
}

function invalidSku(reason: string): never {
  throw new Error(`AMAZON_VARIANT_SKU_INVALID: ${reason}`);
}

/** Stable non-cryptographic identifier, identical in the browser and Pipeline Worker. */
function hashOptionSignature(signature: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(signature)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0").toUpperCase();
}

function optionSuffix(variant: ShopifyVariantInput): string {
  const selections = (variant.optionValues ?? []).map(option => [
    option.optionName.normalize("NFC").trim(), option.name.normalize("NFC").trim(),
  ]);
  if (selections.some(([name, value]) => !name || !value)
      || new Set(selections.map(([name]) => name)).size !== selections.length) {
    invalidSku("Each option must have a non-empty name and value and appear only once.");
  }
  // Code-unit sorting is locale independent; source object/list ordering is not identity.
  selections.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const signature = JSON.stringify(selections);
  const label = selections.flat().join("-").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "D").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/g, "") || "VARIANT";
  // Always include the digest: adding a new choice with the same slug cannot rename an existing SKU.
  return `${label}-${hashOptionSignature(signature)}`;
}

export function assignAmazonVariantSkus(sources: readonly AmazonVariantSkuSource[]): ShopifyVariantInput[] {
  const asinCounts = new Map<string, number>();
  for (const { asin } of sources) {
    if (asin) asinCounts.set(asin, (asinCounts.get(asin) ?? 0) + 1);
  }
  const assignedSkus = new Set<string>();
  return sources.map(({ asin, variant }) => {
    if (!asin) return variant;
    const hasOptions = (variant.optionValues?.length ?? 0) > 0;
    if (sources.length > 1 && !hasOptions && (asinCounts.get(asin) ?? 0) > 1) {
      invalidSku("Variants sharing an ASIN need option selections to distinguish them.");
    }
    const sku = `AMZ-${asin}${sources.length > 1 && hasOptions ? `-${optionSuffix(variant)}` : ""}`;
    if (assignedSkus.has(sku)) invalidSku("Duplicate variant identity or SKU collision; correct the source options before sync.");
    assignedSkus.add(sku);
    return { ...variant, sku };
  });
}
