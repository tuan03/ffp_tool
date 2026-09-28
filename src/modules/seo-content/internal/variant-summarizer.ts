import type { VariantSample, VariantSummary } from "../types";

export type { VariantSample, VariantSummary };

/**
 * Extracts a numeric price from diverse variant representations:
 * - Direct number: 29.99
 * - String: "29.99", "$29.99", "29,99"
 * - Shopify GraphQL price object: { amount: "29.99", currencyCode: "USD" }
 */
function extractNumericPrice(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if ("amount" in record) {
      return extractNumericPrice(record.amount);
    }
    if ("price" in record) {
      return extractNumericPrice(record.price);
    }
  }

  return undefined;
}

/**
 * Extracts a display string for price.
 */
function extractDisplayPrice(value: unknown): string | undefined {
  const num = extractNumericPrice(value);
  if (num !== undefined) {
    return num.toFixed(2);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/**
 * Extracts SKU from a variant object.
 */
function extractSku(variant: Record<string, unknown>): string | undefined {
  if (typeof variant.sku === "string" && variant.sku.trim().length > 0) {
    return variant.sku.trim();
  }
  if (typeof variant.SKU === "string" && variant.SKU.trim().length > 0) {
    return variant.SKU.trim();
  }
  if (typeof variant.barcode === "string" && variant.barcode.trim().length > 0) {
    return variant.barcode.trim();
  }
  return undefined;
}

interface ParsedOptionsResult {
  readonly optionNames: readonly string[];
  readonly optionsMap?: Readonly<Record<string, string>>;
}

/**
 * Parses options from diverse variant schemas:
 * - Shopify GraphQL `selectedOptions`: Array<{ name: string; value: string }>
 * - Auto SEO / Crawler `options`: Record<string, string> or Array<string>
 * - Shopify REST: `option1`, `option2`, `option3`
 */
function extractVariantOptions(variant: Record<string, unknown>): ParsedOptionsResult {
  const names: string[] = [];
  const map: Record<string, string> = {};

  // 1. Shopify GraphQL: selectedOptions
  if (Array.isArray(variant.selectedOptions)) {
    for (const opt of variant.selectedOptions) {
      if (typeof opt === "object" && opt !== null) {
        const o = opt as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name.trim() : undefined;
        const val = typeof o.value === "string" ? o.value.trim() : undefined;
        if (name) {
          names.push(name);
          if (val) {
            map[name] = val;
          }
        }
      }
    }
  }

  // 2. Crawler / Auto SEO: options as Record<string, string>
  if (typeof variant.options === "object" && variant.options !== null && !Array.isArray(variant.options)) {
    const opts = variant.options as Record<string, unknown>;
    for (const [key, val] of Object.entries(opts)) {
      const cleanKey = key.trim();
      if (cleanKey.length > 0 && !names.includes(cleanKey)) {
        names.push(cleanKey);
      }
      if (typeof val === "string" && val.trim().length > 0) {
        map[cleanKey] = val.trim();
      }
    }
  }

  // 3. Shopify REST: option1, option2, option3
  const restOptionKeys = ["option1", "option2", "option3"] as const;
  for (let i = 0; i < restOptionKeys.length; i++) {
    const k = restOptionKeys[i];
    const val = variant[k];
    if (typeof val === "string" && val.trim().length > 0) {
      const defaultName = `Option ${i + 1}`;
      if (!names.includes(defaultName)) {
        names.push(defaultName);
      }
      map[defaultName] = val.trim();
    }
  }

  return {
    optionNames: names,
    optionsMap: Object.keys(map).length > 0 ? map : undefined,
  };
}

/**
 * Extracts a friendly title for a variant.
 */
function extractVariantTitle(
  variant: Record<string, unknown>,
  optionsMap?: Readonly<Record<string, string>>,
  index = 0,
): string {
  if (typeof variant.title === "string" && variant.title.trim().length > 0) {
    return variant.title.trim();
  }
  if (typeof variant.name === "string" && variant.name.trim().length > 0) {
    return variant.name.trim();
  }
  if (optionsMap && Object.values(optionsMap).length > 0) {
    return Object.values(optionsMap).join(" / ");
  }
  return `Variant ${index + 1}`;
}

/**
 * Compacts a raw variant array of any size into a standardized, lightweight `VariantSummary`.
 *
 * Robust against empty, missing, or malformed variant structures across
 * Shopify REST, Shopify GraphQL, Auto SEO, and Crawler payloads.
 */
export function summarizeVariants(variants?: readonly unknown[]): VariantSummary {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      variantCount: 0,
      optionNames: [],
      sampleVariants: [],
      minPrice: undefined,
      maxPrice: undefined,
    };
  }

  const validVariantRecords: Array<{
    readonly record: Record<string, unknown>;
    readonly originalIndex: number;
    readonly price?: number;
    readonly displayPrice?: string;
    readonly sku?: string;
    readonly options: ParsedOptionsResult;
  }> = [];

  const seenOptionNames = new Set<string>();
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  for (let i = 0; i < variants.length; i++) {
    const item = variants[i];
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const numPrice = extractNumericPrice(record.price ?? record.priceAmount ?? record.price_amount);
    const displayPrice = extractDisplayPrice(record.price ?? record.priceAmount ?? record.price_amount);
    const sku = extractSku(record);
    const parsedOptions = extractVariantOptions(record);

    for (const optName of parsedOptions.optionNames) {
      seenOptionNames.add(optName);
    }

    if (numPrice !== undefined) {
      if (minPrice === undefined || numPrice < minPrice) {
        minPrice = numPrice;
      }
      if (maxPrice === undefined || numPrice > maxPrice) {
        maxPrice = numPrice;
      }
    }

    validVariantRecords.push({
      record,
      originalIndex: i,
      price: numPrice,
      displayPrice,
      sku,
      options: parsedOptions,
    });
  }

  if (validVariantRecords.length === 0) {
    return {
      variantCount: 0,
      optionNames: [],
      sampleVariants: [],
      minPrice: undefined,
      maxPrice: undefined,
    };
  }

  // Select up to 2-3 representative samples:
  // If count <= 3, take all.
  // If count > 3, select first, middle, and last.
  const sampleIndices: number[] = [];
  const totalValid = validVariantRecords.length;

  if (totalValid <= 3) {
    for (let i = 0; i < totalValid; i++) {
      sampleIndices.push(i);
    }
  } else {
    sampleIndices.push(0);
    sampleIndices.push(Math.floor(totalValid / 2));
    sampleIndices.push(totalValid - 1);
  }

  const sampleVariants: VariantSample[] = sampleIndices.map((idx) => {
    const v = validVariantRecords[idx];
    const title = extractVariantTitle(v.record, v.options.optionsMap, v.originalIndex);
    return {
      title,
      ...(v.displayPrice !== undefined ? { price: v.displayPrice } : {}),
      ...(v.sku !== undefined ? { sku: v.sku } : {}),
      ...(v.options.optionsMap !== undefined ? { options: v.options.optionsMap } : {}),
    };
  });

  return {
    variantCount: totalValid,
    optionNames: Array.from(seenOptionNames),
    sampleVariants,
    minPrice,
    maxPrice,
  };
}
