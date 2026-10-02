import { calculateSha256, canonicalizeJson } from "./canonical-json";
import type { AutoSeoProductPayload } from "./seo-content";

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function normalizeImage(value: unknown): Readonly<Record<string, string | number>> | null {
  const image = asRecord(value);
  if (!image) return null;

  const id = optionalTrimmedString(image.id);
  const url = optionalTrimmedString(image.url) ?? optionalTrimmedString(image.src);
  const altText = optionalTrimmedString(image.altText) ?? optionalTrimmedString(image.alt);
  const position = optionalFiniteNumber(image.position);
  const width = optionalFiniteNumber(image.width);
  const height = optionalFiniteNumber(image.height);

  if (!id && !url && !altText && position === undefined && width === undefined && height === undefined) {
    return null;
  }

  return {
    ...(id ? { id } : {}),
    ...(url ? { url } : {}),
    ...(altText ? { altText } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function normalizeVariant(value: unknown): Readonly<Record<string, unknown>> | null {
  const variant = asRecord(value);
  if (!variant) return null;

  const id = optionalTrimmedString(variant.id);
  const title = optionalTrimmedString(variant.title);
  if (!id && !title) return null;

  return {
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(optionalTrimmedString(variant.price) ? { price: optionalTrimmedString(variant.price) } : {}),
    ...(optionalTrimmedString(variant.compareAtPrice)
      ? { compareAtPrice: optionalTrimmedString(variant.compareAtPrice) }
      : {}),
    ...(optionalTrimmedString(variant.sku) ? { sku: optionalTrimmedString(variant.sku) } : {}),
    ...(optionalTrimmedString(variant.barcode)
      ? { barcode: optionalTrimmedString(variant.barcode) }
      : {}),
  };
}

function compareNormalizedRecords(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): number {
  const leftPosition = typeof left.position === "number" ? left.position : Number.MAX_SAFE_INTEGER;
  const rightPosition = typeof right.position === "number" ? right.position : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;

  const leftKey = `${String(left.id ?? "")}\u0000${String(left.url ?? "")}`;
  const rightKey = `${String(right.id ?? "")}\u0000${String(right.url ?? "")}`;
  return leftKey.localeCompare(rightKey);
}

function normalizeRecordArray(
  value: unknown,
  normalizer: (entry: unknown) => Readonly<Record<string, unknown>> | null,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizer)
    .filter((entry): entry is Readonly<Record<string, unknown>> => entry !== null)
    .sort(compareNormalizedRecords);
}

export function normalizeAutoSeoHashInput(
  product: AutoSeoProductPayload,
): unknown {
  const seo = asRecord(product.seo);
  const tags = Array.isArray(product.tags)
    ? [...new Set(product.tags
      .map(optionalTrimmedString)
      .filter((tag): tag is string => tag !== undefined))].sort((left, right) => left.localeCompare(right))
    : [];

  return {
    id: optionalTrimmedString(product.id) ?? "",
    title: optionalTrimmedString(product.title) ?? "",
    handle: optionalTrimmedString(product.handle) ?? "",
    description: optionalTrimmedString(product.description) ?? "",
    descriptionHtml: optionalTrimmedString(product.descriptionHtml) ?? "",
    status: optionalTrimmedString(product.status) ?? "",
    vendor: optionalTrimmedString(product.vendor) ?? "",
    productType: optionalTrimmedString(product.productType) ?? "",
    tags,
    onlineStoreUrl: optionalTrimmedString(product.onlineStoreUrl) ?? "",
    featuredImage: normalizeImage(product.featuredImage),
    images: normalizeRecordArray(product.images, normalizeImage),
    variants: normalizeRecordArray(product.variants, normalizeVariant),
    seo: {
      title: optionalTrimmedString(seo?.title) ?? "",
      description: optionalTrimmedString(seo?.description) ?? "",
    },
  };
}

export function calculateAutoSeoInputHash(product: AutoSeoProductPayload): string {
  return calculateSha256(canonicalizeJson(normalizeAutoSeoHashInput(product)));
}
