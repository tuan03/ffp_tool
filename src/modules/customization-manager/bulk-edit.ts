import type { ProductCustomization } from "../customization-normalizer";

export interface BulkCustomizationField {
  readonly key: string;
  readonly kind: "surface" | "text" | "option";
  readonly label: string;
  readonly detail: string;
  readonly imageUrl?: string;
}

export interface BulkCustomizationEntry<Product> {
  readonly product: Product;
  readonly customization: ProductCustomization;
}

export interface BulkCustomizationGroup<Product> {
  readonly schemaKey: string;
  readonly fields: readonly BulkCustomizationField[];
  readonly entries: readonly BulkCustomizationEntry<Product>[];
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function displayLabel(value: unknown, fallback: string): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!isRecord(value)) return fallback;

  for (const key of ["text", "name", "value", "default", "en", "en_US"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

function textFieldKey(field: Record<string, unknown>): string {
  return [
    "text",
    normalizeIdentity(field.label),
    normalizeIdentity(field.type),
    String(field.required ?? false),
    String(field.minLength ?? ""),
    String(field.maxLength ?? ""),
    String(field.maxLines ?? ""),
  ].join(":");
}

function optionFieldKey(field: Record<string, unknown>): string {
  const options: readonly unknown[] = Array.isArray(field.options) ? field.options : [];
  const optionLabels = options
    .map((option) => normalizeIdentity(isRecord(option) ? option.label : option))
    .sort();
  return [
    "option",
    normalizeIdentity(field.label),
    normalizeIdentity(field.type),
    String(field.required ?? false),
    optionLabels.join("|"),
  ].join(":");
}

function surfaceLabel(surface: Record<string, unknown>, index: number): string {
  return displayLabel(surface.name ?? surface.label, `Mặt in ${index + 1}`);
}

function surfaceKey(surface: Record<string, unknown>, index: number): string {
  return ["surface", normalizeIdentity(surfaceLabel(surface, index)), String(index)].join(":");
}

function surfaceImageUrl(surface: Record<string, unknown>): string | undefined {
  for (const directKey of ["previewUrl", "url"]) {
    const directUrl = surface[directKey];
    if (typeof directUrl === "string" && directUrl.trim()) return directUrl.trim();
  }
  for (const nestedKey of ["baseImage", "image"]) {
    const nestedImage = surface[nestedKey];
    if (!isRecord(nestedImage)) continue;
    const nestedUrl = nestedImage.url;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) return nestedUrl.trim();
  }
  return undefined;
}

export function listBulkCustomizationFields(
  customization: ProductCustomization,
): readonly BulkCustomizationField[] {
  const surfaces = (customization.surfaces ?? []).flatMap((surface, index) => {
    if (!isRecord(surface)) return [];
    return [{
      key: surfaceKey(surface, index),
      kind: "surface" as const,
      label: surfaceLabel(surface, index),
      detail: `Mặt in ${index + 1}`,
      imageUrl: surfaceImageUrl(surface),
    }];
  });
  const textFields = (customization.textInputs ?? []).flatMap((field) => {
    if (!isRecord(field)) return [];
    return [{
      key: textFieldKey(field),
      kind: "text" as const,
      label: displayLabel(field.label, "Trường chữ"),
      detail: `Tối đa ${typeof field.maxLength === "number" ? field.maxLength : 50} ký tự`,
    }];
  });
  const optionFields = (customization.optionGroups ?? []).flatMap((field) => {
    if (!isRecord(field)) return [];
    const optionCount = Array.isArray(field.options) ? field.options.length : 0;
    return [{
      key: optionFieldKey(field),
      kind: "option" as const,
      label: displayLabel(field.label, "Nhóm lựa chọn"),
      detail: `${optionCount} lựa chọn`,
    }];
  });

  return [...surfaces, ...textFields, ...optionFields];
}

export function groupBulkCustomizations<Product>(
  entries: readonly BulkCustomizationEntry<Product>[],
): readonly BulkCustomizationGroup<Product>[] {
  const grouped = new Map<string, BulkCustomizationEntry<Product>[]>();

  for (const entry of entries) {
    const schemaKey = listBulkCustomizationFields(entry.customization)
      .map((field) => field.key)
      .sort()
      .join("\n");
    const existing = grouped.get(schemaKey) ?? [];
    existing.push(entry);
    grouped.set(schemaKey, existing);
  }

  return [...grouped.entries()]
    .map(([schemaKey, groupEntries]) => ({
      schemaKey,
      fields: listBulkCustomizationFields(groupEntries[0].customization),
      entries: groupEntries,
    }))
    .sort((left, right) => right.entries.length - left.entries.length);
}

export function removeBulkCustomizationFields(
  customization: ProductCustomization,
  fieldKeys: ReadonlySet<string>,
): ProductCustomization {
  return {
    ...customization,
    surfaces: (customization.surfaces ?? []).filter(
      (surface, index) => !isRecord(surface) || !fieldKeys.has(surfaceKey(surface, index)),
    ),
    textInputs: (customization.textInputs ?? []).filter(
      (field) => !isRecord(field) || !fieldKeys.has(textFieldKey(field)),
    ),
    optionGroups: (customization.optionGroups ?? []).filter(
      (field) => !isRecord(field) || !fieldKeys.has(optionFieldKey(field)),
    ),
  };
}
