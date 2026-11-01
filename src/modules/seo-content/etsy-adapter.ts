import type { CrawlProduct } from "../customization-normalizer";
import { fromCustomizationProduct } from "./customization-adapter";
import type { SeoContentInput, SeoStoreProfile } from "./types";

export interface EtsySeoImageSummary {
  readonly id: string;
  readonly alt?: string;
  readonly roles?: readonly string[];
}

export interface EtsySeoVariantSummary {
  readonly id: string;
  readonly sourceVariantId?: string;
  readonly sku?: string;
  readonly price?: number | null;
  readonly currency?: string;
  readonly options: Readonly<Record<string, string>>;
}

export interface EtsySeoPersonalizationSummary {
  readonly isPersonalized: boolean;
  readonly auditStatus: "verified_static" | "verified_custom" | "error";
  readonly syncBlockers: readonly string[];
  readonly fieldsSummary: readonly {
    readonly id: string;
    readonly kind: "text" | "dropdown" | "upload";
    readonly label: string;
    readonly required: boolean;
    readonly instructions?: string;
    readonly maxLength?: number;
    readonly maxFiles?: number;
    readonly options?: readonly string[];
  }[];
}

export interface EtsySeoContext {
  readonly listingId: string;
  readonly canonicalUrl?: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly materials: readonly string[];
  readonly taxonomy: readonly string[];
  readonly images: readonly EtsySeoImageSummary[];
  readonly variants: readonly EtsySeoVariantSummary[];
  readonly personalization: EtsySeoPersonalizationSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(trimmed);
  }
  return items;
}

function stableImageId(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `image-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function extractMaterials(snapshot: Record<string, unknown>): readonly string[] {
  const direct = toStringList(snapshot.materials);
  if (direct.length > 0) return direct;
  if (isRecord(snapshot.etsyMetadata)) {
    const fromMeta = toStringList(snapshot.etsyMetadata.materials);
    if (fromMeta.length > 0) return fromMeta;
  }
  if (isRecord(snapshot.productDetails)) {
    const rawMaterials = snapshot.productDetails.Materials ?? snapshot.productDetails.materials;
    if (Array.isArray(rawMaterials)) return toStringList(rawMaterials);
    if (typeof rawMaterials === "string" && rawMaterials.trim()) {
      return rawMaterials
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function extractTaxonomy(snapshot: Record<string, unknown>): readonly string[] {
  const categories = toStringList(snapshot.categories);
  if (categories.length > 0) return categories;
  if (isRecord(snapshot.etsyMetadata)) {
    const taxonomyPath = toStringList(snapshot.etsyMetadata.taxonomyPath);
    if (taxonomyPath.length > 0) return taxonomyPath;
  }
  return [];
}

function extractVariants(snapshot: Record<string, unknown>): readonly EtsySeoVariantSummary[] {
  const rawList = Array.isArray(snapshot.variants)
    ? snapshot.variants
    : Array.isArray(snapshot.sourceVariants)
      ? snapshot.sourceVariants
      : [];
  const summaries: EtsySeoVariantSummary[] = [];

  for (let index = 0; index < rawList.length; index += 1) {
    const raw = rawList[index];
    if (!isRecord(raw)) continue;
    const options: Record<string, string> = {};
    if (isRecord(raw.options)) {
      for (const [key, val] of Object.entries(raw.options)) {
        if (typeof val === "string" && key.trim() && val.trim()) {
          options[key.trim()] = val.trim();
        }
      }
    } else if (Array.isArray(raw.selectedOptions)) {
      for (const opt of raw.selectedOptions) {
        if (isRecord(opt) && typeof opt.name === "string" && typeof opt.value === "string") {
          const name = opt.name.trim();
          const val = opt.value.trim();
          if (name && val) options[name] = val;
        }
      }
    }

    let price: number | null | undefined;
    let currency: string | undefined;
    if (typeof raw.price === "number" && Number.isFinite(raw.price)) {
      price = raw.price;
    } else if (isRecord(raw.price) && typeof raw.price.amount === "number" && Number.isFinite(raw.price.amount)) {
      price = raw.price.amount;
      if (typeof raw.price.currency === "string" && raw.price.currency.trim()) {
        currency = raw.price.currency.trim();
      }
    }
    if (!currency && typeof raw.currency === "string" && raw.currency.trim()) {
      currency = raw.currency.trim();
    }

    const sourceVariantId =
      typeof raw.sourceVariantId === "string" && raw.sourceVariantId.trim()
        ? raw.sourceVariantId.trim()
        : typeof raw.etsyProductId === "string" && raw.etsyProductId.trim()
          ? raw.etsyProductId.trim()
          : undefined;
    const id =
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : sourceVariantId ?? `variant-${index + 1}`;
    const sku = typeof raw.sku === "string" && raw.sku.trim() ? raw.sku.trim() : undefined;

    summaries.push({
      id,
      ...(sourceVariantId ? { sourceVariantId } : {}),
      ...(sku ? { sku } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(currency ? { currency } : {}),
      options,
    });
  }

  return summaries;
}

function extractPersonalization(snapshot: Record<string, unknown>): EtsySeoPersonalizationSummary {
  const customization = isRecord(snapshot.customization) ? snapshot.customization : null;
  const textInputs = customization && Array.isArray(customization.textInputs) ? customization.textInputs : [];
  const optionGroups = customization && Array.isArray(customization.optionGroups) ? customization.optionGroups : [];
  const imageInputs = customization && Array.isArray(customization.imageInputs) ? customization.imageInputs : [];

  const fieldsSummary: Array<EtsySeoPersonalizationSummary["fieldsSummary"][number]> = [];

  for (const rawInput of textInputs) {
    if (!isRecord(rawInput)) continue;
    fieldsSummary.push({
      id: typeof rawInput.id === "string" && rawInput.id.trim() ? rawInput.id.trim() : `text-${fieldsSummary.length + 1}`,
      kind: "text",
      label: typeof rawInput.label === "string" && rawInput.label.trim() ? rawInput.label.trim() : "Personalization",
      required: rawInput.required === true,
      ...(typeof rawInput.instructions === "string" && rawInput.instructions.trim()
        ? { instructions: rawInput.instructions.trim() }
        : {}),
      ...(typeof rawInput.maxLength === "number" && rawInput.maxLength > 0 ? { maxLength: rawInput.maxLength } : {}),
    });
  }

  for (const rawGroup of optionGroups) {
    if (!isRecord(rawGroup)) continue;
    const options = Array.isArray(rawGroup.options)
      ? rawGroup.options
          .map((opt) => (isRecord(opt) && typeof opt.label === "string" ? opt.label.trim() : ""))
          .filter(Boolean)
      : [];
    fieldsSummary.push({
      id: typeof rawGroup.id === "string" && rawGroup.id.trim() ? rawGroup.id.trim() : `option-${fieldsSummary.length + 1}`,
      kind: "dropdown",
      label: typeof rawGroup.label === "string" && rawGroup.label.trim() ? rawGroup.label.trim() : "Option",
      required: rawGroup.required === true,
      ...(typeof rawGroup.instructions === "string" && rawGroup.instructions.trim()
        ? { instructions: rawGroup.instructions.trim() }
        : {}),
      ...(options.length > 0 ? { options } : {}),
    });
  }

  for (const rawUpload of imageInputs) {
    if (!isRecord(rawUpload)) continue;
    fieldsSummary.push({
      id: typeof rawUpload.id === "string" && rawUpload.id.trim() ? rawUpload.id.trim() : `upload-${fieldsSummary.length + 1}`,
      kind: "upload",
      label: typeof rawUpload.label === "string" && rawUpload.label.trim() ? rawUpload.label.trim() : "Upload Photo",
      required: rawUpload.required === true,
      ...(typeof rawUpload.instructions === "string" && rawUpload.instructions.trim()
        ? { instructions: rawUpload.instructions.trim() }
        : {}),
      ...(typeof rawUpload.maxFiles === "number" && rawUpload.maxFiles > 0 ? { maxFiles: rawUpload.maxFiles } : {}),
    });
  }

  const syncBlockers = toStringList(snapshot.syncBlockers);
  const rawAudit = snapshot.customizerAuditStatus;
  const hasMappedFields = fieldsSummary.length > 0 || Boolean(customization && customization.hasCustomization === true);
  const auditStatus: EtsySeoPersonalizationSummary["auditStatus"] =
    rawAudit === "error" || rawAudit === "verified_custom" || rawAudit === "verified_static"
      ? rawAudit
      : hasMappedFields
        ? "verified_custom"
        : "verified_static";

  const etsyMeta = isRecord(snapshot.etsyMetadata) ? snapshot.etsyMetadata : null;
  const isPersonalized =
    hasMappedFields ||
    auditStatus === "verified_custom" ||
    Boolean(etsyMeta && etsyMeta.isPersonalizable === true);

  return {
    isPersonalized,
    auditStatus,
    syncBlockers,
    fieldsSummary,
  };
}

/**
 * Projects an Etsy CrawlProduct onto the V2 semantic SEO input contract (`{ images, niche, storeProfile }`).
 * Rich Etsy source metadata (`title`, `description`, `tags`, `materials`, `taxonomy`, `variants`, `personalization`)
 * is exposed alongside via `extractEtsySeoContext` in `job_get_context` (`etsySource`) exclusively when `source === "etsy"`.
 */
export function fromEtsyCustomizationProduct(
  product: CrawlProduct,
  niche: string,
  storeProfile: SeoStoreProfile,
): SeoContentInput {
  return fromCustomizationProduct(product, niche, storeProfile);
}

/**
 * Extracts structured Etsy source context for Codex MCP (`job_get_context`) without leaking into `auto_seo` or `amazon`.
 */
export function extractEtsySeoContext(snapshot: unknown): EtsySeoContext | undefined {
  if (!isRecord(snapshot)) return undefined;

  const explicitId = typeof snapshot.sourceProductId === "string" ? snapshot.sourceProductId.trim() : "";
  const sourceKey = typeof snapshot.sourceKey === "string" ? snapshot.sourceKey.trim() : "";
  const listingId =
    explicitId ||
    (sourceKey.toLowerCase().startsWith("etsy:") ? sourceKey.slice("etsy:".length).trim() : "");
  if (!listingId) return undefined;

  const title =
    (typeof snapshot.sourceTitle === "string" && snapshot.sourceTitle.trim()) ||
    (typeof snapshot.title === "string" && snapshot.title.trim()) ||
    "";
  const description =
    (typeof snapshot.description === "string" && snapshot.description.trim()) ||
    (typeof snapshot.descriptionHtml === "string" && snapshot.descriptionHtml.trim()) ||
    "";

  const images: EtsySeoImageSummary[] = [];
  const seenUrls = new Set<string>();
  if (Array.isArray(snapshot.media)) {
    for (const rawMedia of snapshot.media) {
      if (!isRecord(rawMedia)) continue;
      if (String(rawMedia.kind ?? "image").toLowerCase() === "video") continue;
      const url = typeof rawMedia.url === "string" ? rawMedia.url.trim() : "";
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const id = typeof rawMedia.id === "string" && rawMedia.id.trim() ? rawMedia.id.trim() : stableImageId(url);
      const alt = typeof rawMedia.alt === "string" && rawMedia.alt.trim() ? rawMedia.alt.trim() : undefined;
      const roles = toStringList(rawMedia.roles);
      images.push({
        id,
        ...(alt ? { alt } : {}),
        ...(roles.length > 0 ? { roles } : {}),
      });
    }
  }

  return {
    listingId,
    ...(typeof snapshot.canonicalUrl === "string" && snapshot.canonicalUrl.trim()
      ? { canonicalUrl: snapshot.canonicalUrl.trim() }
      : {}),
    title,
    description,
    tags: toStringList(snapshot.tags),
    materials: extractMaterials(snapshot),
    taxonomy: extractTaxonomy(snapshot),
    images,
    variants: extractVariants(snapshot),
    personalization: extractPersonalization(snapshot),
  };
}
