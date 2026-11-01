import { GatewayError } from "../errors";
import type { ProductVariantState } from "./product-variant-pages";

export function matchEtsySyncVariants(desired: readonly Record<string, unknown>[], existing: readonly ProductVariantState[], managedIds: readonly string[]): {
  updates: { variant: Record<string, unknown>; id: string }[]; creates: Record<string, unknown>[]; deletes: string[];
} {
  const managed = new Set(managedIds);
  const used = new Set<string>();
  const matched = new Map<Record<string, unknown>, string>();
  const ordered = [...desired].sort((a,b) => String(a.sku).localeCompare(String(b.sku), "en"));
  if (ordered.some(v => typeof v.sku !== "string" || !v.sku.startsWith("ETSY-")) || new Set(ordered.map(v=>v.sku)).size !== ordered.length) {
    throw new GatewayError("Etsy variant identities are missing or duplicated.", "SHOPIFY_INVALID_INPUT", 400);
  }
  for (const variant of ordered) {
    const exact = existing.filter(row => row.sku === variant.sku);
    if (exact.length > 1) throw new GatewayError("Ambiguous existing Etsy SKU; reconcile variants before sync.", "SHOPIFY_INVALID_INPUT", 400);
    if (exact[0]) { matched.set(variant,exact[0].id); used.add(exact[0].id); }
  }
  for (const variant of ordered) {
    if (matched.has(variant)) continue;
    const legacy = existing.filter(row => managed.has(row.id) && !used.has(row.id) && (
      (typeof variant.legacySku === "string" && row.sku === variant.legacySku) ||
      (typeof variant.etsyProductId === "string" && row.etsyProductId?.value === variant.etsyProductId && !row.sku?.startsWith("ETSY-"))
    ));
    if (legacy.length > 1) throw new GatewayError("Ambiguous legacy Etsy variant; no write sent.", "SHOPIFY_INVALID_INPUT", 400);
    if (legacy[0]) { matched.set(variant,legacy[0].id); used.add(legacy[0].id); }
  }
  return {
    updates: desired.flatMap(variant => { const id=matched.get(variant); return id ? [{variant,id}] : []; }),
    creates: desired.filter(variant=>!matched.has(variant)),
    deletes: existing.filter(row=>managed.has(row.id)&&!used.has(row.id)).map(row=>row.id),
  };
}
