import { assignEtsyVariantSkus } from "./variant-sku";
import type { ShopifySyncProductInput, ShopifyVariantInput } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function blocked(reason: string): never {
  throw new Error(`ETSY_PERSONALIZATION_VARIANTS_BLOCKED: ${reason}`);
}

/** Pure projection; crawl evidence is retained unchanged for future syncs. */
export function projectEtsyPersonalizationVariants(product: ShopifySyncProductInput): ShopifySyncProductInput {
  if (product.sourcePlatform !== "etsy" && !product.sourceKey?.startsWith("etsy:")) return product;
  if (product.etsyVariantProjection) return product;
  const variants = product.variants ?? [];
  const baseAxes = [...new Set(variants.flatMap(v => (v.optionValues ?? []).map(o => o.optionName)))];
  const config = product.customization;
  const groups = config?.optionGroups ?? [];
  if (baseAxes.length + groups.length > 3) {
    blocked(`Có ${baseAxes.length + groups.length} nhóm lựa chọn; Shopify chỉ hỗ trợ tối đa 3 nhóm. Giữ sản phẩm ở SEO Review để xử lý.`);
  }
  if (!groups.length) return product;
  if (!variants.length) blocked("Không có biến thể nguồn hợp lệ để chuyển personalization.");
  if (Array.isArray(config?.conditionalRules) && config.conditionalRules.length) {
    blocked("Personalization có điều kiện phụ thuộc; chưa thể chuyển thành tổ hợp độc lập.");
  }
  for (const question of product.etsyPersonalizationQuestions ?? []) {
    if (question.type === "dropdown" && question.addOnPrice != null) {
      blocked("Dropdown có phụ phí Etsy; cần kiểm tra giá trước khi chuyển thành biến thể.");
    }
  }
  const axisNames = new Set(baseAxes.map(name => name.toLowerCase()));
  const groupIds = new Set<string>();
  const choices = groups.map(group => {
    const id = clean(group.id);
    const label = clean(group.label);
    if (!id || groupIds.has(id) || !label || label.length > 255 || axisNames.has(label.toLowerCase())) {
      blocked("Tên nhóm lựa chọn hoặc mã câu hỏi trống/trùng; cần kiểm tra dữ liệu Etsy.");
    }
    groupIds.add(id);
    axisNames.add(label.toLowerCase());
    const values: { id: string; label: string }[] = [];
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const raw of Array.isArray(group.options) ? group.options : []) {
      if (!record(raw)) blocked(`Nhóm ${label} có lựa chọn không hợp lệ.`);
      if (raw.isAvailable === false) continue;
      const optionId = clean(raw.id);
      const optionLabel = clean(raw.label);
      if (!optionId || ids.has(optionId) || !optionLabel || optionLabel.length > 255 || labels.has(optionLabel.toLowerCase())) {
        blocked(`Nhóm ${label} có lựa chọn trống hoặc trùng.`);
      }
      if (raw.price != null && (!record(raw.price) || raw.price.amount !== 0)) {
        blocked(`Nhóm ${label} có phụ phí hoặc chưa xác minh được giá.`);
      }
      ids.add(optionId);
      labels.add(optionLabel.toLowerCase());
      values.push({ id: optionId, label: optionLabel });
    }
    if (!values.length) blocked(`Nhóm ${label} không có lựa chọn hợp lệ.`);
    if (group.required !== true) {
      let noneLabel = "No personalization";
      while (labels.has(noneLabel.toLowerCase())) noneLabel += " (none)";
      let noneId = "__none__";
      while (ids.has(noneId)) noneId += "_";
      values.unshift({ id: noneId, label: noneLabel });
    }
    return { id, label, values };
  });
  let count = variants.length;
  for (const group of choices) {
    count *= group.values.length;
    if (count > 2048) blocked(`Dự kiến hơn 2048 biến thể (ít nhất ${count}); vượt giới hạn chuyển đổi. Không tự bỏ lựa chọn.`);
  }
  const expanded: { variant: ShopifyVariantInput; identityOptionValues: NonNullable<ShopifyVariantInput["optionValues"]> }[] = [];
  for (const base of variants) {
    if ((base.optionValues?.length ?? 0) !== baseAxes.length || baseAxes.some(axis => !base.optionValues?.some(o => o.optionName === axis && o.name.trim()))) {
      blocked("Biến thể nguồn thiếu hoặc trùng nhóm lựa chọn.");
    }
    let combinations = [{ variant: { ...base, legacySku: base.sku }, identityOptionValues: [
      { optionName: "source", name: base.sku || base.etsyProductId || JSON.stringify(base.optionValues ?? []) },
    ] }];
    for (const group of choices) {
      combinations = combinations.flatMap(combination => group.values.map(value => ({
        variant: { ...combination.variant, optionValues: [...(combination.variant.optionValues ?? []), { optionName: group.label, name: value.label }] },
        identityOptionValues: [...combination.identityOptionValues, { optionName: group.id, name: value.id }],
      })));
    }
    expanded.push(...combinations);
  }
  const projectedVariants = assignEtsyVariantSkus(expanded.map(v => ({ ...v,
    listingId: product.etsyListingId ?? product.sourceKey?.slice(5) ?? "", etsyProductId: v.variant.etsyProductId,
  })));
  const hasFreeform = Boolean(config?.textInputs?.length || (Array.isArray(config?.imageInputs) && config.imageInputs.length));
  const retainedTypes = record(config?.componentTypes)
    ? Object.fromEntries(Object.entries(config.componentTypes).filter(([id]) => !groupIds.has(id))) : {};
  const customization = hasFreeform && config ? { ...config,
    optionGroups: [], componentTypes: retainedTypes,
    controlOrder: config.controlOrder?.filter(control => !groupIds.has(clean(control.id))),
  } : null;
  const optionNames = [...baseAxes, ...choices.map(g => g.label)];
  return { ...product, variants: projectedVariants, options: optionNames, customization,
    customizerAuditStatus: product.customizerAuditStatus === "error" ? "error" : hasFreeform ? "verified_custom" : "verified_static",
    etsyVariantProjection: { version: 1, baseVariantCount: variants.length, variantCount: count, optionNames },
  };
}
