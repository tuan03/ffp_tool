import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { CrawlProduct } from "../../src/modules/customization-normalizer";
import { applySizeOptionNormalization, getSizeOptionContext, validateSizeOptionSubmission } from "../seo-worker/size-option-normalization";
import { getWorkerContracts } from "../seo-worker/mcp-server";
import { fromCustomizationNormalizerProduct } from "../../src/modules/shopify-sync";

const labels = ["1.5x1.5 ft (!!!)", "3x3 ft - S - For entryways", "Medium: 4x6ft (Popular) - Fits 7x10ft room", "XL (120 × 180 cm)"];
const cleaned = ["1.5x1.5 ft", "3x3 ft - S", "Medium: 4x6ft", "XL (120 × 180 cm)"];

function productWithLabels(values = labels): CrawlProduct {
  return { id: "product-1", sourceKey: "amazon:B0PARENT00:color:pink", title: "PRIVATE_TITLE", warnings: [],
    variants: values.map((label, index) => ({ id: `variant-${index}`, sku: `AMZ-ASIN-${index}`, sourceAsin: `ASIN${index}`,
      options: { Color: "Hot Pink", Size: label }, price: { amount: 15 + index * 10, currency: "USD" } })),
    sourceVariants: values.map((label, index) => ({ asin: `ASIN${index}`, options: { Color: "Hot Pink", Size: label } })),
    variantMatrix: { dimensions: { Size: values }, expectedCount: values.length, complete: true },
  };
}

function jobFor(product: CrawlProduct, profile = "default", source = "amazon"): GptSeoJob {
  return { execution: { source, originalSnapshot: { ...product, crawlerProfileSlug: profile, crawlerSizeOptionsVersion: 1 } } } as unknown as GptSeoJob;
}

function proposalFor(job: GptSeoJob, values: readonly string[] = cleaned) {
  const context = getSizeOptionContext(job);
  assert.ok(context);
  return { version: 1 as const, groups: context.groups.map(group => ({ groupId: group.groupId, label: group.label,
    reason: "Remove auxiliary notes; retain real size", choices: group.choices.map((choice, index) => ({ choiceId: choice.choiceId, label: values[index] ?? choice.label })) })) };
}

test("size context is opt-in default-profile crawler metadata, separate from SEO evidence", () => {
  const product = productWithLabels();
  const context = getSizeOptionContext(jobFor(product));
  assert.ok(context);
  assert.equal(context.groups.length, 1);
  assert.deepEqual(context.groups[0].choices.map(choice => choice.label), labels);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_TITLE|Hot Pink|AMZ-ASIN/);
  for (const profile of ["jeminise", "preaurem", "other"]) assert.equal(getSizeOptionContext(jobFor(product, profile)), undefined);
  assert.equal(getSizeOptionContext(jobFor(product, "default", "auto_seo")), undefined);
  assert.equal(getSizeOptionContext({ execution: { source: "amazon", originalSnapshot: product } } as unknown as GptSeoJob), undefined);
});

test("Codex cleanup reaches variants, source options and matrix without changing identity or prices", () => {
  const product = productWithLabels();
  const original = structuredClone(product);
  const job = jobFor(product);
  const normalized = validateSizeOptionSubmission(job, proposalFor(job));
  assert.ok(normalized);
  assert.deepEqual(normalized.warnings, []);
  const applied = applySizeOptionNormalization(product, normalized);
  assert.deepEqual(product, original);
  assert.deepEqual(applied.variants, original.variants?.map((variant, index) => {
    assert.ok(typeof variant === "object" && variant !== null && "options" in variant);
    return { ...variant, options: { Color: "Hot Pink", Size: cleaned[index] } };
  }));
  assert.deepEqual(applied.sourceVariants, original.sourceVariants?.map((variant, index) => ({ ...(variant as object), options: { Color: "Hot Pink", Size: cleaned[index] } })));
  assert.deepEqual(applied.variantMatrix, { dimensions: { Size: cleaned }, expectedCount: 4, complete: true });
  assert.equal(applied.sourceKey, original.sourceKey);
  assert.deepEqual(applySizeOptionNormalization(applied, normalized), applied);
});

test("changed dimensions, unit conversions, invented labels and lost size codes fall back to original", () => {
  for (const [original, proposed] of [["1.5x1.5 ft (!!!)", "15x15 ft"], ["120 cm (Popular)", "1.2 m"],
    ["3x3 ft - S - For entryways", "3x3 ft"], ["Medium: 4x6ft (Popular)", "4x6ft"], ["XL (120 × 180 cm)", "XL (120 × 180 cm) Best"],
    ["3-4 ft", "3 4 ft"], ["4 ft x 6 ft", "4 ft 6 ft"], ["2XL (Recommended)", "2 (Recommended)"], ["11 1/2 inch", "11 1/2"]]) {
    const job = jobFor(productWithLabels([original]));
    const normalized = validateSizeOptionSubmission(job, proposalFor(job, [proposed]));
    assert.ok(normalized);
    assert.equal(normalized.groups[0].choices[0].label, original);
    assert.ok(normalized.warnings.length);
  }
});

test("AI can remove previously unseen wording while retaining decimal, fraction and meaningful punctuation", () => {
  const originals = ["3x3 ft (Customer Favorite!)", "11 1/2 inch — Ideal in your hallway", "4x6 ft - Super Small"];
  const proposed = ["3x3 ft", "11 1/2 inch", "4x6 ft"];
  const job = jobFor(productWithLabels(originals));
  const normalized = validateSizeOptionSubmission(job, proposalFor(job, proposed));
  assert.ok(normalized);
  assert.deepEqual(normalized.warnings, []);
  assert.deepEqual(normalized.groups[0].choices.map(choice => choice.label), proposed);
});

test("renaming a size group cannot overwrite an existing axis", () => {
  const product: CrawlProduct = { variants: [{ options: { "Size (Popular)": "4x6 ft", Size: "XL" } }] };
  const job = jobFor(product);
  const context = getSizeOptionContext(job);
  assert.ok(context);
  const normalized = validateSizeOptionSubmission(job, { version: 1, groups: context.groups.map(group => ({
    groupId: group.groupId, label: "Size", reason: "Remove marketing", choices: group.choices,
  })) });
  assert.ok(normalized);
  assert.ok(normalized.warnings.some(warning => warning.includes("NAME_COLLISION")));
  assert.deepEqual(applySizeOptionNormalization(product, normalized).variants, product.variants);
});

test("MCP contract advertises size mappings without making them mandatory for unrelated jobs", () => {
  const contracts = getWorkerContracts();
  assert.match(JSON.stringify(contracts.submission), /"sizeOptions"/);
  assert.ok(!contracts.submission.required?.includes("sizeOptions"));
  assert.match(contracts.rules, /display-only data/);
});

test("distinct original choices cannot collapse after AI cleanup", () => {
  const values = ["4x6 ft (Popular)", "4x6 ft (Recommended)"];
  const job = jobFor(productWithLabels(values));
  const normalized = validateSizeOptionSubmission(job, proposalFor(job, ["4x6 ft", "4x6 ft"]));
  assert.ok(normalized);
  assert.deepEqual(normalized.groups[0].choices.map(choice => choice.label), values);
  assert.ok(normalized.warnings.some(warning => warning.includes("COLLISION")));
});

test("missing or foreign choices retain originals, and a missing required proposal asks for repair", () => {
  const job = jobFor(productWithLabels());
  assert.throws(() => validateSizeOptionSubmission(job, undefined), /SIZE_OPTIONS_REQUIRED/);
  const proposal = proposalFor(job);
  const normalized = validateSizeOptionSubmission(job, { ...proposal, groups: [{ ...proposal.groups[0], choices: [{ choiceId: "foreign", label: "XL" }] }] });
  assert.ok(normalized);
  assert.deepEqual(normalized.groups[0].choices.map(choice => choice.label), labels);
  assert.ok(normalized.warnings.length);
});

test("Customize free and paid choices preserve IDs, defaults, assets, prices and paid variant metadata", () => {
  const product: CrawlProduct = { warnings: [],
    variants: [{ id: "variant", sku: "SKU", options: { "Bag Size (Recommended)": "M (1 Kid)" }, metadata: { paidOptions: [
      { groupId: "paid", groupLabel: "Bag Size (Recommended)", optionId: "medium", label: "M (1 Kid)", price: { amount: 5 } },
    ] } }],
    customization: { fingerprint: "raw-fingerprint", optionGroups: [{ id: "free", label: "Gift Size", options: [{ id: "large", label: "L (3–4 Kids)" }] }],
      pricing: { paidOptionGroups: [{ id: "paid", label: "Bag Size (Recommended)", defaultOptionId: "medium", options: [{ id: "medium", label: "M (1 Kid)", price: { amount: 5 }, thumbnailImage: { url: "asset" } }] }] } },
  };
  const job = jobFor(product);
  const context = getSizeOptionContext(job);
  assert.ok(context);
  const proposal = { version: 1, groups: context.groups.map(group => ({ groupId: group.groupId,
    label: group.label.replace(" (Recommended)", ""), reason: "Remove note", choices: group.choices.map(choice => ({ choiceId: choice.choiceId, label: choice.label.split(" (")[0] })) })) };
  const normalized = validateSizeOptionSubmission(job, proposal);
  const applied = applySizeOptionNormalization(product, normalized);
  assert.equal(applied.customization?.fingerprint, "raw-fingerprint");
  assert.deepEqual(applied.customization?.pricing?.paidOptionGroups?.[0], { id: "paid", label: "Bag Size", defaultOptionId: "medium", options: [{ id: "medium", label: "M", price: { amount: 5 }, thumbnailImage: { url: "asset" } }] });
  assert.equal(applied.customization?.optionGroups?.[0].options[0].label, "L");
  assert.deepEqual(applied.variants, [{ id: "variant", sku: "SKU", options: { "Bag Size": "M" }, metadata: { paidOptions: [{ groupId: "paid", groupLabel: "Bag Size", optionId: "medium", label: "M", price: { amount: 5 } }] } }]);
});

test("recovered checkpoint cannot rename options from a different product snapshot", () => {
  const product = productWithLabels();
  const job = jobFor(product);
  const normalized = validateSizeOptionSubmission(job, proposalFor(job));
  const changed = productWithLabels(["10x20 cm"]);
  const applied = applySizeOptionNormalization(changed, normalized);
  assert.deepEqual(applied.variants, changed.variants);
  assert.ok(Array.isArray(applied.warnings) && applied.warnings.some(warning => String(warning).includes("SNAPSHOT")));
});

test("Shopify receives cleaned display choices while retaining the original short variant SKUs", () => {
  const product: CrawlProduct = { ...productWithLabels(), asin: "B012345678" };
  const job = jobFor(product);
  const applied = applySizeOptionNormalization(product, validateSizeOptionSubmission(job, proposalFor(job)));
  const before = fromCustomizationNormalizerProduct(product);
  const after = fromCustomizationNormalizerProduct(applied);
  assert.deepEqual(after.variants?.map(variant => variant.sku), before.variants?.map(variant => variant.sku));
  assert.deepEqual(after.variants?.map(variant => variant.optionValues?.find(option => option.optionName === "Size")?.name), cleaned);
  assert.deepEqual(after.variants?.map(variant => variant.price), before.variants?.map(variant => variant.price));
});
