import type { SeoContentSnapshotInput, SeoImageSnapshot } from "./domain";

export interface SeoValueDiff {
  readonly field: string;
  readonly before: SeoDiffValue;
  readonly after: SeoDiffValue;
}

export type SeoDiffValue =
  | { readonly presence: "MISSING" }
  | { readonly presence: "VALUE"; readonly value: string | number | null };

export interface SeoImageDiff {
  readonly mediaGid: string;
  readonly change: "ADDED" | "REMOVED" | "CHANGED";
  readonly fields: readonly SeoValueDiff[];
}

export interface SeoSnapshotDiff {
  readonly fields: readonly SeoValueDiff[];
  readonly images: readonly SeoImageDiff[];
  readonly hasChanges: boolean;
}

const SCALAR_FIELDS = ["title", "descriptionHtml", "seoTitle", "seoDescription"] as const;
const IMAGE_FIELDS = ["imageUrl", "alt", "width", "height"] as const;

function value(present: boolean, current: string | number | null): SeoDiffValue {
  return present ? { presence: "VALUE", value: current } : { presence: "MISSING" };
}

function changed(field: string, beforePresent: boolean, before: string | number | null,
  afterPresent: boolean, after: string | number | null): SeoValueDiff | null {
  if (beforePresent === afterPresent && before === after) return null;
  return { field, before: value(beforePresent, before), after: value(afterPresent, after) };
}

function imageFields(before: SeoImageSnapshot | undefined, after: SeoImageSnapshot | undefined): readonly SeoValueDiff[] {
  return IMAGE_FIELDS.flatMap(field => {
    const difference = changed(field, before !== undefined, before?.[field] ?? null, after !== undefined, after?.[field] ?? null);
    return difference ? [difference] : [];
  });
}

export function diffSeoSnapshots(before: SeoContentSnapshotInput, after: SeoContentSnapshotInput): SeoSnapshotDiff {
  const fields: SeoValueDiff[] = [];
  for (const field of SCALAR_FIELDS) {
    const difference = changed(field, true, before[field], true, after[field]);
    if (difference) fields.push(difference);
  }
  const aeoKeys = [...new Set([...Object.keys(before.aeoMetafields), ...Object.keys(after.aeoMetafields)])].sort();
  for (const key of aeoKeys) {
    const beforePresent = Object.prototype.hasOwnProperty.call(before.aeoMetafields, key);
    const afterPresent = Object.prototype.hasOwnProperty.call(after.aeoMetafields, key);
    const difference = changed(`aeoMetafields.${key}`, beforePresent, before.aeoMetafields[key] ?? null,
      afterPresent, after.aeoMetafields[key] ?? null);
    if (difference) fields.push(difference);
  }

  const beforeImages = new Map(before.images.map(image => [image.mediaGid, image]));
  const afterImages = new Map(after.images.map(image => [image.mediaGid, image]));
  const mediaGids = [...new Set([...beforeImages.keys(), ...afterImages.keys()])].sort();
  const images: SeoImageDiff[] = [];
  for (const mediaGid of mediaGids) {
    const beforeImage = beforeImages.get(mediaGid);
    const afterImage = afterImages.get(mediaGid);
    const differences = imageFields(beforeImage, afterImage);
    if (!differences.length) continue;
    images.push({ mediaGid, change: beforeImage ? afterImage ? "CHANGED" : "REMOVED" : "ADDED", fields: differences });
  }
  return { fields, images, hasChanges: fields.length > 0 || images.length > 0 };
}
