import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoEnqueue, GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { extractEtsySeoContext } from "../../src/modules/seo-content";
import { downloadProductImage } from "../custom-gpt-seo/images";
import { normalizeSeoEnqueue } from "../custom-gpt-seo/input-contract";
import type { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";

const storeProfile = {
  profileId: "jeminise-bedding",
  profileVersion: "2.0.0",
  storeId: "jeminise",
  storeName: "Jeminise",
  locale: "en-US",
  language: "English",
  niche: "Gifts & Home Decor",
  brandVoice: ["warm", "clear"],
  contentRules: ["Ground product facts in source evidence"],
  prohibitedClaims: ["Unsupported material claims"],
  seoConstraints: { maxTitleCharacters: 70, maxDescriptionCharacters: 160, maxAltCharacters: 125 },
} as const;

function buildPersistedJob(
  source: "amazon" | "etsy" | "auto_seo",
  originalSnapshot: Record<string, unknown>,
): GptSeoJob {
  const enqueue: GptSeoEnqueue = {
    input: {
      images: [
        {
          id: "image-1",
          url:
            source === "etsy"
              ? "https://i.etsystatic.com/12345/r/il/abcdef/654321/il_fullxfull.654321_xyzw.jpg"
              : "https://cdn.shopify.com/s/files/image.webp",
        },
      ],
      niche: storeProfile.niche,
      storeProfile,
    },
    execution: {
      storeId: "jeminise",
      productId: source === "auto_seo" ? "gid://shopify/Product/123" : "etsy:1789456123",
      source,
      sourceIdentity: source === "auto_seo" ? "gid://shopify/Product/123" : "etsy:1789456123",
      providerId: "codex_mcp",
      pipelineVersion: "seo-worker-v2",
      originalSnapshot,
    },
  };
  const normalized = normalizeSeoEnqueue(enqueue);
  return {
    ...enqueue,
    ...normalized,
    id: `job-${source}`,
    storeId: normalized.execution.storeId,
    source: normalized.execution.source,
    sourceIdentity: normalized.execution.sourceIdentity,
    original: normalized.execution.originalSnapshot,
    inputHash: `hash-${source}`,
    settings: {
      provider: "codex_mcp",
      batchSize: 1,
      version: 1,
      language: "English",
      instructions: "",
    },
    status: "IN_PROGRESS",
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
  } as GptSeoJob;
}

test("extractEtsySeoContext extracts Etsy title, description, tags, materials, taxonomy, variants, and personalization", () => {
  const snapshot = {
    sourcePlatform: "etsy",
    sourceProductId: "1789456123",
    canonicalUrl: "https://www.etsy.com/listing/1789456123/personalized-ceramic-mug",
    title: "Personalized Ceramic Dog Mug",
    description: "Hand-printed ceramic mug made to order.",
    tags: ["dog lover gift", "custom pet mug", "Dog Lover Gift"],
    materials: ["Ceramic", "Lead-free ink"],
    categories: ["Home & Living", "Kitchen & Dining", "Drink & Barware", "Mugs"],
    customizerAuditStatus: "verified_custom",
    media: [
      {
        url: "https://i.etsystatic.com/12345/r/il/abcdef/654321/il_fullxfull.654321_xyzw.jpg",
        alt: "Mug front",
      },
    ],
    variants: [
      {
        sourceVariantId: "88112233",
        price: 16.95,
        currency: "USD",
        options: { Size: "11oz", Color: "White" },
      },
    ],
    customization: {
      hasCustomization: true,
      textInputs: [
        {
          id: "etsy_q_1",
          label: "Dog Name",
          required: true,
          maxLength: 25,
          instructions: "Type dog name.",
        },
      ],
    },
  };

  const context = extractEtsySeoContext(snapshot);
  assert.ok(context);
  assert.equal(context.listingId, "1789456123");
  assert.equal(context.title, "Personalized Ceramic Dog Mug");
  assert.deepEqual(context.tags, ["dog lover gift", "custom pet mug"]);
  assert.deepEqual(context.materials, ["Ceramic", "Lead-free ink"]);
  assert.deepEqual(context.taxonomy, ["Home & Living", "Kitchen & Dining", "Drink & Barware", "Mugs"]);
  assert.equal(context.variants.length, 1);
  assert.equal(context.variants[0]?.sourceVariantId, "88112233");
  assert.equal(context.personalization.isPersonalized, true);
  assert.equal(context.personalization.auditStatus, "verified_custom");
  assert.equal(context.personalization.fieldsSummary[0]?.maxLength, 25);
});

test("SEO worker exposes etsySource and catalog-driven classification ONLY for Etsy jobs, without Jeminise hardcoded lock", async () => {
  const etsySnapshot = {
    sourcePlatform: "etsy",
    sourceProductId: "1789456123",
    crawlerClassificationMode: "automatic",
    title: "Handcrafted Wooden Keepsake Box",
    description: "Solid walnut keepsake box with laser engraving.",
    tags: ["keepsake box", "engraved gift"],
    materials: ["Walnut wood"],
    categories: ["Home & Living", "Storage & Organization"],
    customizerAuditStatus: "verified_custom",
    variants: [{ sourceVariantId: "88112233", price: 39.0, options: { Finish: "Walnut" } }],
    customization: {
      hasCustomization: true,
      textInputs: [{ id: "etsy_q_1", label: "Engraving Text", required: true, maxLength: 50 }],
    },
  };

  const etsyJob = buildPersistedJob("etsy", etsySnapshot);
  let savedSubmission: unknown;
  const etsyRepo = {
    checkpointReceipt: async () => null,
    readJob: async () => etsyJob,
    saveCheckpoint: async (_token: string, _lease: unknown, input: { payload: unknown }) => {
      savedSubmission = input.payload;
      return { jobId: etsyJob.id, status: "VALIDATING" };
    },
  } as unknown as SeoWorkerRepository;

  const etsyWorkflow = createWorkerWorkflow(etsyRepo, {
    checkSource: async () => undefined,
    classificationCatalog: async () => ({
      collections: [{ id: "gid://shopify/Collection/77", title: "Keepsake Gifts", description: "Engraved wooden boxes" }],
      productTypes: ["Keepsake Box", "Quilt Bedding Set"],
    }),
    taxonomyCategoryResolve: async (_storeId, categoryId) => ({
      id: categoryId,
      name: "Jewelry & Keepsake Boxes",
      fullName: "Home & Garden > Decor > Jewelry & Keepsake Boxes",
      isLeaf: true,
    }),
  });

  const lease = {
    jobId: etsyJob.id,
    runId: "run-1",
    sessionId: "session-1",
    leaseId: "lease-1",
    leaseVersion: 1,
    expiresAt: 1000,
  };

  const etsyContext = await etsyWorkflow.context("token", lease);
  assert.ok(etsyContext.etsySource);
  assert.equal(etsyContext.etsySource.listingId, "1789456123");
  assert.deepEqual(etsyContext.etsySource.materials, ["Walnut wood"]);
  assert.ok(etsyContext.classification);
  // Even on storeId "jeminise", Etsy classification uses store catalog freely without fixedProductType lock!
  assert.equal(etsyContext.classification.fixedProductType, undefined);

  await etsyWorkflow.submit("token", lease, "submit-etsy", {
    draft: { productTitle: "Personalized Walnut Keepsake Box" },
    alts: {},
    classification: {
      status: "ready",
      collectionId: "gid://shopify/Collection/77",
      productType: "Keepsake Box",
      taxonomyCategoryId: "gid://shopify/TaxonomyCategory/hg-1",
      reason: "Solid walnut engraved keepsake box matches Keepsake Gifts collection",
      seoTagProfile: {
        product: "Keepsake Box",
        theme: "Engraved Wood",
        audience: "Couples",
        occasion: "Anniversary",
        isPersonalized: true,
      },
      evidence: {
        imageIds: ["image-1"],
        visualTheme: "Engraved Walnut Box",
        collectionTheme: "Keepsake Gifts",
        alternatives: [],
      },
    },
  });
  assert.ok(savedSubmission);

  // Confirm Amazon and Auto SEO jobs NEVER leak etsySource
  for (const nonEtsySource of ["amazon", "auto_seo"] as const) {
    const otherJob = buildPersistedJob(nonEtsySource, { ...etsySnapshot, updatedAt: "v1" });
    const otherRepo = {
      checkpointReceipt: async () => null,
      readJob: async () => otherJob,
      saveCheckpoint: async () => ({ jobId: otherJob.id, status: "VALIDATING" }),
    } as unknown as SeoWorkerRepository;
    const otherWorkflow = createWorkerWorkflow(otherRepo, {
      checkSource: async () => undefined,
      classificationCatalog: async () => ({
        collections: [{ id: "gid://shopify/Collection/1", title: "Bedding", description: "" }],
        productTypes: ["Quilt Bedding Set"],
      }),
    });
    const otherContext = await otherWorkflow.context("token", { ...lease, jobId: otherJob.id });
    assert.equal(otherContext.etsySource, undefined);
  }
});

test("downloadProductImage permits i.etsystatic.com CDN and blocks untrusted hosts", async () => {
  await assert.rejects(
    downloadProductImage("https://evil.example.com/image.jpg"),
    /not an approved product CDN/,
  );
});
