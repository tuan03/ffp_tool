import type { ProductCustomization } from "../customization-normalizer";

export interface BulkCustomizationField {
  readonly key: string;
  readonly kind: "text" | "option";
  readonly label: string;
  readonly detail: string;
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

export function listBulkCustomizationFields(
  customization: ProductCustomization,
): readonly BulkCustomizationField[] {
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

  return [...textFields, ...optionFields];
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
    textInputs: (customization.textInputs ?? []).filter(
      (field) => !isRecord(field) || !fieldKeys.has(textFieldKey(field)),
    ),
    optionGroups: (customization.optionGroups ?? []).filter(
      (field) => !isRecord(field) || !fieldKeys.has(optionFieldKey(field)),
    ),
  };
}
