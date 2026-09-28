import type { VariantSample, VariantSummary } from "../types";

export type { VariantSample, VariantSummary };

/**
 * Maximum bounds to prevent prompt token bloat from corrupted/adversarial catalogs.
 */
const MAX_OPTION_NAME_LENGTH = 60;
const MAX_OPTION_VALUE_LENGTH = 60;
const MAX_TITLE_LENGTH = 150;
const MAX_SKU_LENGTH = 60;
const MAX_OPTION_NAMES = 30;

/**
 * Extracts a numeric price from diverse variant representations:
 * - Direct number: 29.99
 * - String: "29.99", "$29.99", "1,299.99", "$10,000.00", "29,99"
 * - Shopify GraphQL price object: { amount: "29.99", currencyCode: "USD" }
 *
 * Robust against circular references, negative amounts, and thousand-separators.
 */
function extractNumericPrice(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): number | undefined {
  if (depth > 5) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    // Reject negative price strings (e.g. "-50.00", "-$50", "($50.00)")
    if (/^[-(\s]*[$€£¥]?\s*[-(\d]/.test(trimmed) && (trimmed.includes("-") || trimmed.startsWith("("))) {
      return undefined;
    }

    let cleaned = trimmed.replace(/[^0-9.,]/g, "");
    if (cleaned.length === 0) {
      return undefined;
    }

    // Determine thousand vs decimal separators
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");

    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma < lastDot) {
        // US style: 1,299.99 or 10,000.00 -> comma is thousand separator
        cleaned = cleaned.replace(/,/g, "");
      } else {
        // European style: 1.299,99 or 10.000,00 -> dot is thousand separator
        cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
      }
    } else if (lastComma !== -1) {
      // Only comma(s) exist
      const parts = cleaned.split(",");
      if (parts.length > 2) {
        // Multiple commas: 1,000,000 -> thousands separators
        cleaned = cleaned.replace(/,/g, "");
      } else if (parts.length === 2) {
        if (parts[1].length === 2) {
          // European cents: 29,99 -> 29.99
          cleaned = cleaned.replace(",", ".");
        } else if (parts[1].length === 3) {
          // Thousand separator: 1,000 -> 1000
          cleaned = cleaned.replace(",", "");
        } else if (parts[1].length === 1) {
          // Single decimal digit: 29,5 -> 29.5
          cleaned = cleaned.replace(",", ".");
        } else {
          cleaned = cleaned.replace(/,/g, "");
        }
      }
    } else if (lastDot !== -1) {
      // Only dot(s) exist
      const parts = cleaned.split(".");
      if (parts.length > 2) {
        // European thousands: 1.000.000 -> remove dots
        cleaned = cleaned.replace(/\./g, "");
      }
      // Single dot is standard decimal point (e.g. 1299.99)
    }

    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    if ("amount" in record) {
      return extractNumericPrice(record.amount, seen, depth + 1);
    }
    if ("price" in record) {
      return extractNumericPrice(record.price, seen, depth + 1);
    }
    if ("priceAmount" in record) {
      return extractNumericPrice(record.priceAmount, seen, depth + 1);
    }
    if ("price_amount" in record) {
      return extractNumericPrice(record.price_amount, seen, depth + 1);
    }
  }

  return undefined;
}

/**
 * Extracts a display string for price.
 */
function extractDisplayPrice(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): string | undefined {
  const num = extractNumericPrice(value, seen, depth);
  if (num !== undefined) {
    return num.toFixed(2);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    if (!trimmed.includes("-") && !trimmed.startsWith("(")) {
      return trimmed.slice(0, 30);
    }
  }
  return undefined;
}

/**
 * Extracts SKU from a variant object, bounded to MAX_SKU_LENGTH.
 */
function extractSku(variant: Record<string, unknown>): string | undefined {
  let raw: string | undefined;
  if (typeof variant.sku === "string" && variant.sku.trim().length > 0) {
    raw = variant.sku.trim();
  } else if (typeof variant.SKU === "string" && variant.SKU.trim().length > 0) {
    raw = variant.SKU.trim();
  } else if (typeof variant.barcode === "string" && variant.barcode.trim().length > 0) {
    raw = variant.barcode.trim();
  }
  return raw ? raw.slice(0, MAX_SKU_LENGTH) : undefined;
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
        const rawName = typeof o.name === "string" ? o.name.trim() : undefined;
        const rawVal = typeof o.value === "string" ? o.value.trim() : undefined;
        const name = rawName && rawName.length > 0 ? rawName.slice(0, MAX_OPTION_NAME_LENGTH) : undefined;
        const val = rawVal && rawVal.length > 0 ? rawVal.slice(0, MAX_OPTION_VALUE_LENGTH) : undefined;
        if (name) {
          if (!names.includes(name)) {
            names.push(name);
          }
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
      const cleanKey = key.trim().slice(0, MAX_OPTION_NAME_LENGTH);
      if (cleanKey.length > 0 && !names.includes(cleanKey)) {
        names.push(cleanKey);
      }
      if (typeof val === "string" && val.trim().length > 0) {
        map[cleanKey] = val.trim().slice(0, MAX_OPTION_VALUE_LENGTH);
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
      map[defaultName] = val.trim().slice(0, MAX_OPTION_VALUE_LENGTH);
    }
  }

  return {
    optionNames: names,
    optionsMap: Object.keys(map).length > 0 ? map : undefined,
  };
}

/**
 * Extracts a friendly title for a variant, bounded to MAX_TITLE_LENGTH.
 */
function extractVariantTitle(
  variant: Record<string, unknown>,
  optionsMap?: Readonly<Record<string, string>>,
  index = 0,
): string {
  let title = "";
  if (typeof variant.title === "string" && variant.title.trim().length > 0) {
    title = variant.title.trim();
  } else if (typeof variant.name === "string" && variant.name.trim().length > 0) {
    title = variant.name.trim();
  } else if (optionsMap && Object.values(optionsMap).length > 0) {
    title = Object.values(optionsMap).join(" / ");
  } else {
    title = `Variant ${index + 1}`;
  }
  return title.slice(0, MAX_TITLE_LENGTH);
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
      if (seenOptionNames.size < MAX_OPTION_NAMES) {
        seenOptionNames.add(optName);
      }
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
    optionNames: Array.from(seenOptionNames).slice(0, MAX_OPTION_NAMES),
    sampleVariants,
    minPrice,
    maxPrice,
  };
}
