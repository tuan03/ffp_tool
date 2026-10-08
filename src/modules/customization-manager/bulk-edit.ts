import type {
  CustomizationOptionGroup,
  CustomizationTextInput,
  ProductCustomization,
} from "../customization-normalizer";

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

function textFieldKey(field: CustomizationTextInput): string {
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

function optionFieldKey(field: CustomizationOptionGroup): string {
  const optionLabels = field.options.map((option) => normalizeIdentity(option.label)).sort();
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
  const textFields = (customization.textInputs ?? []).map((field) => ({
    key: textFieldKey(field),
    kind: "text" as const,
    label: field.label?.trim() || "Trường chữ",
    detail: `Tối đa ${field.maxLength ?? 50} ký tự`,
  }));
  const optionFields = (customization.optionGroups ?? []).map((field) => ({
    key: optionFieldKey(field),
    kind: "option" as const,
    label: field.label.trim() || "Nhóm lựa chọn",
    detail: `${field.options.length} lựa chọn`,
  }));

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
      (field) => !fieldKeys.has(textFieldKey(field)),
    ),
    optionGroups: (customization.optionGroups ?? []).filter(
      (field) => !fieldKeys.has(optionFieldKey(field)),
    ),
  };
}
