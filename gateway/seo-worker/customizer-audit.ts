import { createHash } from "node:crypto";

import { canonicalizeJson } from "../canonical-json";
import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { CrawlProduct, ProductCustomization } from "../../src/modules/customization-normalizer";

import { SeoWorkerError } from "./protocol";

export const CUSTOMIZER_AUDIT_VERSION = 2 as const;

export type CustomizerAuditOutcome = "valid" | "static" | "redundant" | "missing" | "mismatched" | "incomplete" | "error";
export type CustomizerAuditAction = "keep_current" | "remove_customizer" | "restore_source" | "rebuild_customizer" | "mark_error";
export type CustomizerAuditStatus = "verified_static" | "verified_custom" | "error";

export interface CustomizerAuditSubmission {
  readonly version: 2;
  readonly sourceHash: string;
  readonly outcome: CustomizerAuditOutcome;
  readonly action: CustomizerAuditAction;
  readonly confidence: number;
  readonly reason: string;
  readonly imageEvidence: readonly {
    readonly imageId: string;
    readonly observation: string;
  }[];
  readonly sourceEvidence: readonly string[];
  readonly targetCustomization?: ProductCustomization;
}

export interface ValidatedCustomizerAudit extends CustomizerAuditSubmission {
  readonly auditStatus: CustomizerAuditStatus;
  readonly normalizedCustomization: ProductCustomization | null;
}

interface CustomizerAuditSnapshot {
  readonly current: ProductCustomization | null;
  readonly source: ProductCustomization | null;
  readonly imageIds: readonly string[];
  readonly sourceHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneCustomization(value: unknown): ProductCustomization | null {
  if (!isRecord(value)) return null;
  return JSON.parse(JSON.stringify(value)) as ProductCustomization;
}

function snapshot(job: GptSeoJob): CustomizerAuditSnapshot | undefined {
  const original = job.execution.originalSnapshot;
  if (job.execution.source !== "amazon" || !isRecord(original)
    || ![1, CUSTOMIZER_AUDIT_VERSION].includes(Number(original.crawlerCustomizerAuditVersion))) return undefined;
  const imageIds = job.input.images.map(image => image.id);
  if (imageIds.length === 0) throw new SeoWorkerError("CUSTOMIZER_AUDIT_IMAGE_REQUIRED");
  const current = cloneCustomization(original.customization);
  const source = cloneCustomization(original.customizationAuditSource);
  const sourceHash = createHash("sha256").update(canonicalizeJson({ current, source, imageIds })).digest("hex");
  return { current, source, imageIds, sourceHash };
}

export function getCustomizerAuditContext(job: GptSeoJob): {
  readonly version: 2;
  readonly sourceHash: string;
  readonly firstImageId: string;
  readonly imageIds: readonly string[];
  readonly hasCurrentJson: boolean;
  readonly hasSourceJson: boolean;
  readonly current: ProductCustomization | null;
  readonly source: ProductCustomization | null;
  readonly rendererSchema: {
    readonly schemaVersion: 1;
    readonly requiredArrays: readonly string[];
    readonly controlTypes: Readonly<Record<string, string>>;
    readonly referenceRules: readonly string[];
  };
  readonly instructions: string;
} | undefined {
  const audit = snapshot(job);
  if (!audit) return undefined;
  return {
    version: CUSTOMIZER_AUDIT_VERSION,
    sourceHash: audit.sourceHash,
    firstImageId: audit.imageIds[0],
    imageIds: audit.imageIds,
    hasCurrentJson: audit.current !== null,
    hasSourceJson: audit.source !== null,
    current: audit.current,
    source: audit.source,
    rendererSchema: {
      schemaVersion: 1,
      requiredArrays: ["surfaces", "optionGroups", "textInputs", "imageInputs", "fontGroups", "colorGroups",
        "placements", "conditionalRules", "controlOrder", "assets"],
      controlTypes: { text: "TextInputComponent", image: "ImageInputComponent",
        option: "OptionChooserComponent", font: "FontChooserComponent", color: "ColorChooserComponent" },
      referenceRules: [
        "Every control appears exactly once in controlOrder with the matching type and ID.",
        "componentTypes maps every control ID to its component type; componentParent references only componentTypes IDs.",
        "defaultOptionId, regexChoice, placementId, surfaceId and conditional-rule references resolve exactly once.",
        "Product-specific source, pricing, surfaces, assets, URLs and IDs are preserved from current/source or omitted; never invented.",
      ],
    },
    instructions: "View every imageId and compare the complete design with current and source JSON. Resolve the product as verified static, verified custom, or error; uncertain is not a final outcome. For rebuild_customizer, Codex must return targetCustomization as the complete renderer JSON, not a list of controls. The production schema uses schemaVersion 1 plus hasCustomization, source, product, surfaces, optionGroups, textInputs, imageInputs, fontGroups, colorGroups, placements, conditionalRules, regexChoices, controlOrder, componentParent, componentTypes, assets, pricing, fingerprint, shopifyProductId and productId. Preserve correct product-specific envelope, pricing, surfaces and assets exactly from current/source; create or repair the control graph and all of its cross-references yourself. TextInputComponent, ImageInputComponent, OptionChooserComponent, FontChooserComponent and ColorChooserComponent must match controlOrder and componentTypes. Never introduce a URL, Shopify/product/source ID, asset, option, price or placement that is not present in current/source. If authoritative item choices or placement data are unavailable, use error + mark_error instead of inventing them. The server validates and applies the exact target; it does not build controls for you.",
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || !entry.trim())) return undefined;
  return value.map(entry => String(entry).trim());
}

const TARGET_TOP_LEVEL_KEYS = new Set(["schemaVersion", "source", "product", "surfaces", "optionGroups",
  "textInputs", "imageInputs", "fontGroups", "colorGroups", "placements", "conditionalRules",
  "regexChoices", "controlOrder", "componentParent", "componentTypes", "assets", "pricing", "fingerprint",
  "hasCustomization", "shopifyProductId", "productId"]);
const CONTROL_ARRAYS = [
  ["textInputs", "text", "TextInputComponent"],
  ["imageInputs", "image", "ImageInputComponent"],
  ["optionGroups", "option", "OptionChooserComponent"],
  ["fontGroups", "font", "FontChooserComponent"],
  ["colorGroups", "color", "ColorChooserComponent"],
] as const;

function jsonStringSet(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") output.add(value);
  else if (Array.isArray(value)) value.forEach(entry => jsonStringSet(entry, output));
  else if (isRecord(value)) Object.values(value).forEach(entry => jsonStringSet(entry, output));
  return output;
}

function hasForeignProductData(value: unknown, allowed: ReadonlySet<string>, key = ""): boolean {
  if (typeof value === "string") {
    const isProductSpecific = key === "url" || key === "productImageUrl" || key === "shopifyProductId"
      || key === "productId" || key === "fingerprint" || key === "asin" || key === "sku"
      || key === "merchantId" || key === "marketplaceId" || key === "sourceUrl"
      || value.startsWith("gid://") || /^https?:\/\//i.test(value);
    return isProductSpecific && !allowed.has(value);
  }
  if (Array.isArray(value)) return value.some(entry => hasForeignProductData(entry, allowed, key));
  return isRecord(value) && Object.entries(value).some(([childKey, entry]) => hasForeignProductData(entry, allowed, childKey));
}

function matchesBaselineSection(target: Record<string, unknown>, key: string, audit: CustomizerAuditSnapshot,
  allowEmptyArray = false): boolean {
  if (!(key in target)) return true;
  const proposed = target[key];
  if (allowEmptyArray && Array.isArray(proposed) && proposed.length === 0) return true;
  return [audit.current, audit.source].some(baseline => baseline && key in baseline
    && canonicalizeJson(baseline[key]) === canonicalizeJson(proposed));
}

function matchesBaselineOptionGroups(target: Record<string, unknown>, audit: CustomizerAuditSnapshot): boolean {
  const proposed = target.optionGroups;
  if (!Array.isArray(proposed) || proposed.length === 0) return true;
  const knownGroups = [audit.current, audit.source].flatMap(baseline => Array.isArray(baseline?.optionGroups)
    ? baseline.optionGroups : []).map(group => canonicalizeJson(group));
  return proposed.every(group => knownGroups.includes(canonicalizeJson(group)));
}

function parseTargetCustomization(value: unknown, audit: CustomizerAuditSnapshot): ProductCustomization | undefined {
  if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024
    || value.schemaVersion !== 1 || value.hasCustomization !== true
    || Object.keys(value).some(key => !TARGET_TOP_LEVEL_KEYS.has(key))) return undefined;
  const componentTypes = value.componentTypes;
  const componentParent = value.componentParent;
  const regexChoices = value.regexChoices;
  const arrayKeys = ["surfaces", "optionGroups", "textInputs", "imageInputs", "fontGroups", "colorGroups",
    "placements", "conditionalRules", "controlOrder", "assets"];
  if (arrayKeys.some(key => !Array.isArray(value[key]) || (value[key] as unknown[]).length > 250)
    || !isRecord(regexChoices) || !isRecord(componentParent) || !isRecord(componentTypes)) return undefined;

  const controls = new Map<string, { readonly orderType: string; readonly componentType: string }>();
  for (const [arrayKey, orderType, componentType] of CONTROL_ARRAYS) {
    for (const entry of value[arrayKey] as unknown[]) {
      if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 128
        || entry.type !== componentType || typeof entry.label !== "string" || !entry.label.trim()
        || entry.label.length > 200 || typeof entry.required !== "boolean" || controls.has(entry.id)) return undefined;
      controls.set(entry.id, { orderType, componentType });
      if (arrayKey === "optionGroups") {
        if (!Array.isArray(entry.options) || entry.options.length < 1 || entry.options.length > 100
          || typeof entry.defaultOptionId !== "string"
          || !entry.options.some(option => isRecord(option) && option.id === entry.defaultOptionId)
          || entry.options.some(option => !isRecord(option) || typeof option.id !== "string"
            || typeof option.label !== "string" || !option.label.trim())) return undefined;
      }
    }
  }
  const order = value.controlOrder as unknown[];
  if (order.length !== controls.size) return undefined;
  const orderedIds = new Set<string>();
  for (const entry of order) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.type !== "string"
      || orderedIds.has(entry.id) || controls.get(entry.id)?.orderType !== entry.type) return undefined;
    orderedIds.add(entry.id);
  }
  for (const [id, control] of controls) if (componentTypes[id] !== control.componentType) return undefined;
  const supportedComponentTypes = new Set(["PageContainerComponent", "PreviewContainerComponent",
    "FlatContainerComponent", "FlatRatePriceDeltaContainerComponent", "PlacementContainerComponent",
    ...CONTROL_ARRAYS.map(([, , componentType]) => componentType)]);
  if (Object.entries(componentTypes).some(([id, componentType]) => !id.trim()
    || typeof componentType !== "string" || !supportedComponentTypes.has(componentType))) return undefined;
  if (Object.entries(componentParent).some(([id, parentId]) => !(id in componentTypes)
    || typeof parentId !== "string" || !(parentId in componentTypes))) return undefined;

  const surfaceIds = new Set((value.surfaces as unknown[]).map(entry => isRecord(entry) ? entry.id : undefined));
  const placementIds = new Set<string>();
  for (const entry of value.placements as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== "string" || placementIds.has(entry.id)
      || typeof entry.surfaceId !== "string" || !surfaceIds.has(entry.surfaceId)) return undefined;
    placementIds.add(entry.id);
  }
  for (const entry of value.imageInputs as unknown[]) {
    if (isRecord(entry) && entry.placementId !== null && entry.placementId !== undefined
      && (typeof entry.placementId !== "string" || !placementIds.has(entry.placementId))) return undefined;
  }
  for (const entry of value.textInputs as unknown[]) {
    if (isRecord(entry) && entry.regexChoice !== undefined && entry.regexChoice !== null
      && (typeof entry.regexChoice !== "string" || !isRecord(regexChoices[entry.regexChoice]))) return undefined;
  }
  const choiceIds = new Set<string>();
  for (const arrayKey of ["optionGroups", "fontGroups", "colorGroups"] as const) {
    for (const group of value[arrayKey] as unknown[]) if (isRecord(group) && Array.isArray(group.options)) {
      for (const option of group.options) if (isRecord(option) && typeof option.id === "string") choiceIds.add(option.id);
    }
  }
  if (isRecord(value.pricing) && Array.isArray(value.pricing.paidOptionGroups)) {
    for (const group of value.pricing.paidOptionGroups) if (isRecord(group) && Array.isArray(group.options)) {
      for (const option of group.options) if (isRecord(option) && typeof option.id === "string") choiceIds.add(option.id);
    }
  }
  for (const rule of value.conditionalRules as unknown[]) {
    if (!isRecord(rule) || typeof rule.ownerComponentId !== "string" || !(rule.ownerComponentId in componentTypes)
      || typeof rule.dependentId !== "string" || !(rule.dependentId in componentTypes)
      || !isRecord(rule.matcher) || typeof rule.matcher.componentIdentifier !== "string"
      || !(rule.matcher.componentIdentifier in componentTypes) || rule.matcher.matcherType !== "ChoiceMatcher"
      || !Array.isArray(rule.matcher.choiceIds)
      || rule.matcher.choiceIds.some(choiceId => typeof choiceId !== "string" || !choiceIds.has(choiceId))) return undefined;
  }
  if (!["source", "product", "pricing", "fingerprint", "shopifyProductId", "productId"]
    .every(key => matchesBaselineSection(value, key, audit))
    || !["assets", "surfaces", "placements"].every(key => matchesBaselineSection(value, key, audit, true))
    || !matchesBaselineOptionGroups(value, audit)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  const allowedStrings = jsonStringSet(audit.current);
  jsonStringSet(audit.source, allowedStrings);
  if (hasForeignProductData(value, allowedStrings)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  return cloneCustomization(value) ?? undefined;
}

export function validateCustomizerAuditSubmission(job: GptSeoJob, value: unknown): ValidatedCustomizerAudit | undefined {
  const audit = snapshot(job);
  if (!audit) return undefined;
  if (!isRecord(value)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_REQUIRED");
  const sourceEvidence = stringArray(value.sourceEvidence);
  const imageEvidence = Array.isArray(value.imageEvidence) ? value.imageEvidence : [];
  const outcomes: readonly CustomizerAuditOutcome[] = ["valid", "static", "redundant", "missing", "mismatched", "incomplete", "error"];
  const actions: readonly CustomizerAuditAction[] = ["keep_current", "remove_customizer", "restore_source", "rebuild_customizer", "mark_error"];
  const targetCustomization = value.action === "rebuild_customizer"
    ? parseTargetCustomization(value.targetCustomization, audit) : undefined;
  if (value.version !== CUSTOMIZER_AUDIT_VERSION || value.sourceHash !== audit.sourceHash
    || !outcomes.includes(value.outcome as CustomizerAuditOutcome)
    || !actions.includes(value.action as CustomizerAuditAction)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1
    || typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 4000
    || imageEvidence.length !== audit.imageIds.length
    || imageEvidence.some(entry => !isRecord(entry) || typeof entry.imageId !== "string"
      || !audit.imageIds.includes(entry.imageId) || typeof entry.observation !== "string"
      || !entry.observation.trim() || entry.observation.length > 4000)
    || new Set(imageEvidence.map(entry => isRecord(entry) ? entry.imageId : "")).size !== imageEvidence.length
    || !sourceEvidence || sourceEvidence.length > 20
    || (value.action === "rebuild_customizer" ? !targetCustomization : value.targetCustomization !== undefined)) {
    throw new SeoWorkerError("CUSTOMIZER_AUDIT_INVALID");
  }
  const outcome = value.outcome as CustomizerAuditOutcome;
  const action = value.action as CustomizerAuditAction;
  if (outcome === "valid" && (action !== "keep_current" || !audit.current)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  if (action === "remove_customizer" && (!["static", "redundant"].includes(outcome) || value.confidence < 0.9
    || sourceEvidence.length === 0)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  if (action === "restore_source" && (!audit.source || !["missing", "mismatched"].includes(outcome)
    || value.confidence < 0.9 || sourceEvidence.length === 0)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  if (action === "rebuild_customizer" && (!targetCustomization || !["missing", "mismatched", "incomplete"].includes(outcome)
    || value.confidence < 0.9 || sourceEvidence.length === 0)) throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  if (action === "mark_error" && outcome !== "error") throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  if (action === "keep_current" && outcome !== "valid") throw new SeoWorkerError("CUSTOMIZER_AUDIT_UNSAFE");
  const auditStatus: CustomizerAuditStatus = action === "remove_customizer" ? "verified_static"
    : action === "mark_error" ? "error" : "verified_custom";
  const normalizedCustomization = action === "remove_customizer" ? null
    : action === "mark_error" ? null
    : action === "restore_source" ? audit.source
      : action === "rebuild_customizer" && targetCustomization ? targetCustomization
        : audit.current;
  return {
    version: CUSTOMIZER_AUDIT_VERSION,
    sourceHash: audit.sourceHash,
    outcome,
    action,
    confidence: value.confidence,
    reason: value.reason.trim(),
    imageEvidence: imageEvidence.map(entry => ({ imageId: String((entry as Record<string, unknown>).imageId),
      observation: String((entry as Record<string, unknown>).observation).trim() })),
    sourceEvidence,
    ...(targetCustomization ? { targetCustomization } : {}),
    auditStatus,
    normalizedCustomization,
  };
}

export function applyCustomizerAudit(product: CrawlProduct, value: unknown): CrawlProduct {
  if (!isRecord(value) || value.version !== CUSTOMIZER_AUDIT_VERSION
    || !("normalizedCustomization" in value)
    || !["verified_static", "verified_custom", "error"].includes(String(value.auditStatus))) return product;
  const normalized = cloneCustomization(value.normalizedCustomization);
  return { ...product, customization: normalized,
    customizerAuditStatus: value.auditStatus as CustomizerAuditStatus };
}
