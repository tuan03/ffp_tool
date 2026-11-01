import type { ShopifyVariantInput } from "./types";

interface AmazonVariantSkuSource {
  readonly asin?: string;
  readonly variant: ShopifyVariantInput;
  /** Original selections keep SKU identity stable when only display labels change. */
  readonly identityOptionValues?: ShopifyVariantInput["optionValues"];
}

export interface EtsyVariantSkuSource {
  readonly listingId: string;
  readonly etsyProductId?: string;
  readonly variant: ShopifyVariantInput;
  /** Original selections keep SKU identity stable when only display labels change. */
  readonly identityOptionValues?: ShopifyVariantInput["optionValues"];
}

function invalidSku(reason: string): never {
  throw new Error(`AMAZON_VARIANT_SKU_INVALID: ${reason}`);
}

function invalidEtsySku(reason: string): never {
  throw new Error(`ETSY_VARIANT_SKU_INVALID: ${reason}`);
}

/** Stable non-cryptographic identifier, identical in the browser and Pipeline Worker. */
function hashOptionSignature(signature: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(signature)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0").toUpperCase();
}

function optionDigest(variant: ShopifyVariantInput): string {
  const selections = (variant.optionValues ?? []).map(option => [
    option.optionName.normalize("NFC").trim(), option.name.normalize("NFC").trim(),
  ]);
  if (selections.some(([name, value]) => !name || !value)
      || new Set(selections.map(([name]) => name)).size !== selections.length) {
    invalidSku("Each option must have a non-empty name and value and appear only once.");
  }
  // Code-unit sorting is locale independent; source object/list ordering is not identity.
  selections.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return hashOptionSignature(JSON.stringify(selections));
}

export function assignAmazonVariantSkus(sources: readonly AmazonVariantSkuSource[]): ShopifyVariantInput[] {
  const asinCounts = new Map<string, number>();
  for (const { asin } of sources) {
    if (asin) asinCounts.set(asin, (asinCounts.get(asin) ?? 0) + 1);
  }
  const candidates = sources.map(({ asin, variant, identityOptionValues }) => {
    if (!asin) return { variant, baseSku: undefined, digest: undefined };
    const hasOptions = (variant.optionValues?.length ?? 0) > 0;
    if (sources.length > 1 && !hasOptions && (asinCounts.get(asin) ?? 0) > 1) {
      invalidSku("Variants sharing an ASIN need option selections to distinguish them.");
    }
    return { variant, baseSku: `AMZ-${asin}`, digest: sources.length > 1 && hasOptions
      ? optionDigest(identityOptionValues ? { ...variant, optionValues: identityOptionValues } : variant) : undefined };
  });
  const codeLengths = [8, 12, 16] as const;
  const candidateCounts = new Map<string, number>();
  for (const { baseSku, digest } of candidates) {
    if (!baseSku || !digest) continue;
    for (const length of codeLengths) {
      const sku = `${baseSku}-${digest.slice(0, length)}`;
      candidateCounts.set(sku, (candidateCounts.get(sku) ?? 0) + 1);
    }
  }
  const assignedSkus = new Set<string>();
  return candidates.map(({ variant, baseSku, digest }) => {
    if (!baseSku) return variant;
    // Resolve the complete batch, not list position: collision handling is order independent.
    const codeLength = digest ? codeLengths.find(length => candidateCounts.get(`${baseSku}-${digest.slice(0, length)}`) === 1) : undefined;
    if (digest && codeLength === undefined) invalidSku("Duplicate variant identity or full digest collision; correct source options before sync.");
    const sku = digest ? `${baseSku}-${digest.slice(0, codeLength)}` : baseSku;
    if (assignedSkus.has(sku)) invalidSku("Duplicate variant identity or SKU collision; correct the source options before sync.");
    assignedSkus.add(sku);
    return { ...variant, sku };
  });
}

function etsyOptionDigest(
  variant: ShopifyVariantInput,
  etsyProductId?: string,
  requireOptions = false,
): string {
  const selections = (variant.optionValues ?? []).map((option) => [
    option.optionName.normalize("NFC").trim(),
    option.name.normalize("NFC").trim(),
  ]);
  if (selections.length === 0) {
    if (requireOptions && !etsyProductId?.trim()) {
      invalidEtsySku("Multiple Etsy variants without option selections require distinct Etsy variant IDs.");
    }
    return hashOptionSignature(JSON.stringify([["etsyProductId", etsyProductId?.trim() || "default"]]));
  }
  if (
    selections.some(([name, value]) => !name || !value) ||
    new Set(selections.map(([name]) => name)).size !== selections.length
  ) {
    invalidEtsySku("Each Etsy option must have a non-empty name and value and appear only once.");
  }
  selections.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return hashOptionSignature(JSON.stringify(selections));
}

export function assignEtsyVariantSkus(sources: readonly EtsyVariantSkuSource[]): ShopifyVariantInput[] {
  const candidates = sources.map(({ listingId, etsyProductId, variant, identityOptionValues }) => {
    const cleanListingId = listingId.trim();
    if (!/^\d{6,20}$/.test(cleanListingId)) {
      invalidEtsySku("A valid numeric Etsy listingId is required to generate Etsy variant SKUs.");
    }
    const identityVariant = identityOptionValues ? { ...variant, optionValues: identityOptionValues } : variant;
    const digest = etsyOptionDigest(identityVariant, etsyProductId, sources.length > 1);
    return {
      variant: etsyProductId?.trim() ? { ...variant, etsyProductId: etsyProductId.trim() } : variant,
      baseSku: `ETSY-${cleanListingId}`,
      digest,
    };
  });

  const codeLengths = [8, 12, 16] as const;
  const candidateCounts = new Map<string, number>();
  for (const { baseSku, digest } of candidates) {
    for (const length of codeLengths) {
      const sku = `${baseSku}-${digest.slice(0, length)}`;
      candidateCounts.set(sku, (candidateCounts.get(sku) ?? 0) + 1);
    }
  }

  const assignedSkus = new Set<string>();
  return candidates.map(({ variant, baseSku, digest }) => {
    const codeLength = codeLengths.find((length) => candidateCounts.get(`${baseSku}-${digest.slice(0, length)}`) === 1);
    if (codeLength === undefined) {
      invalidEtsySku("Duplicate Etsy variant identity or full digest collision; correct source options before sync.");
    }
    const sku = `${baseSku}-${digest.slice(0, codeLength)}`;
    if (assignedSkus.has(sku)) {
      invalidEtsySku("Duplicate Etsy variant identity or SKU collision; correct source options before sync.");
    }
    assignedSkus.add(sku);
    return { ...variant, sku };
  });
}
