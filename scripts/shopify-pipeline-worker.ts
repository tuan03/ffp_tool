import { createHash } from "node:crypto";
import { hostname } from "node:os";

import {
  loadBootstrappedStores,
  loadLocalEnv,
  startGatewayServer,
} from "../gateway/index";
import {
  normalizeCustomizationProduct,
  type CrawlProduct,
} from "../src/modules/customization-normalizer";
import {
  createShopifyGatewayAdapter,
  createModuleApiRunner,
  resolveShopifyProductForSync,
  type ShopifyFilesStageBinaryResponse,
} from "../src/modules/module-api";
import {
  fromCustomizationNormalizerProduct,
  syncSingleProduct,
  type ShopifyManagedResources,
  type ShopifySyncProductInput,
  type ShopifySyncProductResult,
} from "../src/modules/shopify-sync";
import {
  applySeoContentToCustomizationProduct,
  createSeoContentPipelineSummary,
  fromCustomizationProduct,
  registerSeoContentKeywords,
  runSeoContentDetailed,
  SeoCorpusCommitCoordinator,
  type SeoCorpusCommitResult,
  unregisterSeoContentKeywords,
} from "../src/modules/seo-content";

interface PipelineClaim {
  readonly id: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly sourceKey: string;
  readonly productId: string;
  readonly checksum: string;
  readonly attempt: number;
  readonly product: CrawlProduct;
  readonly settings: {
    readonly imageProfileSlug?: string;
    readonly imageProfileRevision?: string | null;
    readonly [key: string]: unknown;
  };
  readonly existingShopify: {
    readonly productId: string;
    readonly productHandle?: string;
    readonly normalizedChecksum: string;
    readonly managedResources?: ShopifyManagedResources;
  } | null;
}

interface ClaimResponse {
  readonly items: readonly PipelineClaim[];
}

const env = {
  ...loadLocalEnv("src/modules/seo-content"),
  ...loadLocalEnv(),
};
const seoEnvironmentKeys = [
  "AI_PROVIDER",
  "AI_MAX_OUTPUT_TOKENS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_GENAI_USE_ENTERPRISE",
  "GEMINI_ANALYSIS_MODEL",
  "GEMINI_MODEL",
  "SEO_SEARCH_PROVIDER",
  "SEO_SEARCH_LANGUAGE",
  "SEO_SEARCH_COUNTRY",
  "SEO_EMBEDDING_PROVIDER",
  "SEO_EMBEDDING_MODEL",
  "SEO_CONFLICT_CORPUS_PATH",
] as const;
for (const key of seoEnvironmentKeys) {
  if (env[key]) process.env[key] = env[key];
}
if (env.GATEWAY_AUTH_TOKEN) {
  process.env.GATEWAY_AUTH_TOKEN = env.GATEWAY_AUTH_TOKEN;
}
process.env.SEO_CONFLICT_CORPUS_PATH = process.env.SEO_CONFLICT_CORPUS_PATH
  || ".runtime/seo-conflict-corpus.json";
env.SHOPIFY_PROXY_CONFIG = env.SHOPIFY_PROXY_CONFIG || env.AMAZON_CRAWLER_PROXY_CONFIG || "config/amazon-crawler-profiles.json";
process.env.SHOPIFY_PROXY_CONFIG = env.SHOPIFY_PROXY_CONFIG;
const coordinatorUrl = (env.SHOPIFY_PIPELINE_COORDINATOR_URL || "http://127.0.0.1:8766").replace(/\/+$/, "");
const pipelineToken = env.SHOPIFY_PIPELINE_TOKEN?.trim();
const storeId = env.GATEWAY_STORE_ID?.trim();
const workerCount = Math.max(1, Math.min(16, Number(env.SHOPIFY_PIPELINE_WORKERS || 4)));
const gatewayPort = Math.max(1, Number(env.GATEWAY_PORT || 3001));
const gatewayUrl = (env.SHOPIFY_GATEWAY_URL || `http://127.0.0.1:${gatewayPort}/api/shopify`).replace(/\/+$/, "");
const proxyCooldownUntil = new Map<string, number>();
const seoCorpusCommitCoordinator = new SeoCorpusCommitCoordinator();

interface PipelineTimings {
  normalizationMs?: number;
  shopifyResolveMs?: number;
  seoInitialMs?: number;
  seoQueueWaitMs?: number;
  seoRebaseMs?: number;
  seoRegistrationMs?: number;
  seoTotalMs?: number;
  imageProcessingMs?: number;
  imageUploadMs?: number;
  shopifySyncMs?: number;
  totalMs?: number;
}

if (!storeId) {
  throw new Error("GATEWAY_STORE_ID is required for the Shopify pipeline worker.");
}

const configuredStores = loadBootstrappedStores({ env });
const baseStore = configuredStores.find((store) => store.storeId === storeId);
if (!baseStore) {
  throw new Error(`Shopify store '${storeId}' was not found in server configuration.`);
}
const shopAdminHandle = baseStore.shopDomain.replace(/\.myshopify\.com$/i, "");
const proxyStores = configuredStores.filter(
  (store) => store.storeId.startsWith(`${storeId}--`) && store.proxy?.url && store.proxy.failClosed !== false,
);
if (proxyStores.length === 0) {
  throw new Error(
    "No enabled Shopify proxy profiles were found. Configure SHOPIFY_PROXY_CONFIG or config/amazon-crawler-profiles.json.",
  );
}

let gatewayServer: ReturnType<typeof startGatewayServer> | undefined;
if (!env.SHOPIFY_GATEWAY_URL) {
  gatewayServer = startGatewayServer({
    port: gatewayPort,
    host: "127.0.0.1",
    authToken: env.GATEWAY_AUTH_TOKEN,
  });
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map(
    (key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`,
  ).join(",")}}`;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function pipelineHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(pipelineToken ? { "X-Pipeline-Key": pipelineToken } : {}),
  };
}

async function postJson<TResponse>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<TResponse> {
  const response = await fetch(`${coordinatorUrl}${path}`, {
    method: "POST",
    headers: pipelineHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail)
      : `Coordinator returned HTTP ${response.status}.`;
    throw new CoordinatorRequestError(message, response.status);
  }
  return payload as TResponse;
}

class CoordinatorRequestError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CoordinatorRequestError";
  }
}

class PipelineCancelledError extends Error {
  public constructor() {
    super("Product pipeline claim was cancelled.");
    this.name = "PipelineCancelledError";
  }
}

interface ProcessedImageMedia {
  readonly url: string;
  readonly kind?: string;
  readonly sourceAsin?: string;
  readonly alt?: string;
  readonly processedFileToken?: string;
  readonly processedContentType?: string;
  readonly processedUrl?: string;
  readonly [key: string]: unknown;
}

interface ImageProcessingResponse {
  readonly product: CrawlProduct;
  readonly profile: { readonly slug: string; readonly enabled: boolean; readonly revision: string };
  readonly processed: number;
}

async function loadProcessedImage(token: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(
    `${coordinatorUrl}/api/v1/internal/image-processing/files/${encodeURIComponent(token)}`,
    { headers: pipelineToken ? { "X-Pipeline-Key": pipelineToken } : {}, signal },
  );
  if (!response.ok) {
    throw new Error(`Coordinator processed image download failed with HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function stageProcessedMedia(
  product: CrawlProduct,
  runner: ReturnType<typeof createModuleApiRunner>,
  proxyStoreId: string,
  requestPrefix: string,
  signal: AbortSignal,
): Promise<CrawlProduct> {
  const stagedMedia: ProcessedImageMedia[] = [];
  for (const [index, rawMedia] of (product.media ?? []).entries()) {
    if (signal.aborted) throw new PipelineCancelledError();
    const media = rawMedia as ProcessedImageMedia;
    if (!media.processedFileToken) {
      stagedMedia.push(media);
      continue;
    }
    const content = await loadProcessedImage(media.processedFileToken, signal);
    const response = await runner({
      storeId: proxyStoreId,
      operation: "files.stageBinary",
      mode: "apply",
      requestId: `${requestPrefix}-image-${index + 1}-${media.processedFileToken.slice(0, 12)}`,
      payload: {
        filename: `${media.processedFileToken}.jpg`,
        mimeType: media.processedContentType || "image/jpeg",
        contentBase64: content.toString("base64"),
      },
    }) as ShopifyFilesStageBinaryResponse;
    if (signal.aborted) throw new PipelineCancelledError();
    stagedMedia.push({
      ...media,
      processedUrl: response.data.resourceUrl,
      processedFileToken: undefined,
      processedContentType: undefined,
    });
  }
  const firstImageByAsin = new Map<string, string>();
  for (const media of stagedMedia) {
    const sourceAsin = typeof media.sourceAsin === "string" ? media.sourceAsin : "";
    const processedUrl = typeof media.processedUrl === "string" ? media.processedUrl : "";
    if (sourceAsin && processedUrl && !firstImageByAsin.has(sourceAsin)) {
      firstImageByAsin.set(sourceAsin, processedUrl);
    }
  }
  const variants = Array.isArray(product.variants)
    ? product.variants.map((rawVariant) => {
        if (!rawVariant || typeof rawVariant !== "object") return rawVariant;
        const variant = rawVariant as Record<string, unknown>;
        const sourceAsin = typeof variant.sourceAsin === "string" ? variant.sourceAsin : "";
        return firstImageByAsin.has(sourceAsin)
          ? { ...variant, mediaUrl: firstImageByAsin.get(sourceAsin) }
          : variant;
      })
    : product.variants;
  return { ...product, media: stagedMedia, variants };
}

function stripProcessingTokens(product: CrawlProduct): CrawlProduct {
  return {
    ...product,
    media: (product.media ?? []).map((rawMedia) => {
      const media = { ...rawMedia } as Record<string, unknown>;
      delete media.processedFileToken;
      delete media.processedContentType;
      return media as ProcessedImageMedia;
    }),
  };
}

function productBlockers(product: CrawlProduct): string[] {
  const blockers: string[] = [];
  const matrix = product.variantMatrix && typeof product.variantMatrix === "object"
    ? product.variantMatrix as Record<string, unknown>
    : {};
  if (matrix.complete !== true) blockers.push("Variant matrix is incomplete.");
  const sourceVariants = Array.isArray(product.sourceVariants) ? product.sourceVariants : [];
  if (sourceVariants.length === 0) blockers.push("Product has no source variants.");
  if (sourceVariants.some((variant) => {
    if (!variant || typeof variant !== "object") return true;
    return (variant as Record<string, unknown>).price == null;
  })) {
    blockers.push("At least one source variant has no Amazon selling price.");
  }
  const finalVariants = Array.isArray(product.variants) ? product.variants : [];
  if (finalVariants.length === 0 || finalVariants.some((variant) => {
    if (!variant || typeof variant !== "object") return true;
    return (variant as Record<string, unknown>).price == null;
  })) {
    blockers.push("At least one final variant has no selling price.");
  }
  const warnings = Array.isArray(product.warnings) ? product.warnings : [];
  if (warnings.some((warning) => /customiz.*(?:failed|incomplete|omitted|missing)/i.test(String(warning)))) {
    blockers.push("Amazon Customize data is incomplete.");
  }
  return blockers;
}

async function failClaim(
  claim: PipelineClaim,
  workerId: string,
  error: unknown,
  options?: {
    readonly retryable?: boolean;
    readonly reconciliationRequired?: boolean;
    readonly phase?: "normalization" | "seo" | "image_processing" | "shopify";
    readonly timings?: PipelineTimings;
  },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const effectiveStoreId = typeof claim.settings?.storeId === "string" && claim.settings.storeId.trim()
    ? claim.settings.storeId.trim()
    : storeId;
  await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/fail`, {
    workerId,
    storeId: effectiveStoreId,
    error: { message, phase: options?.phase, timings: options?.timings },
    retryable: options?.retryable ?? false,
    reconciliationRequired: options?.reconciliationRequired ?? false,
  });
}

function logPhase(sourceKey: string, phase: string, elapsedMs: number): void {
  console.info(`[Shopify pipeline] ${sourceKey} ${phase} ${elapsedMs}ms`);
}

function isProxyOrNetworkFailure(message: string): boolean {
  return /proxy|network|fetch failed|socket|connect|econn|etimedout|timeout|tunnell?/i.test(message);
}

async function processClaim(
  claim: PipelineClaim,
  workerId: string,
  proxyStoreId: string,
  proxyProfile: string,
): Promise<void> {
  const pipelineStartedAt = Date.now();
  const timings: PipelineTimings = {};
  const cancellationController = new AbortController();
  const throwIfCancelled = (): void => {
    if (cancellationController.signal.aborted) throw new PipelineCancelledError();
  };
  const blockers = productBlockers(claim.product);
  if (blockers.length > 0) {
    await failClaim(claim, workerId, new Error(blockers.join(" ")), {
      phase: "normalization",
      timings: { totalMs: Date.now() - pipelineStartedAt },
    });
    return;
  }

  let normalization: ReturnType<typeof normalizeCustomizationProduct>;
  const normalizationStartedAt = Date.now();
  try {
    normalization = normalizeCustomizationProduct(claim.product);
  } catch (error: unknown) {
    timings.normalizationMs = Date.now() - normalizationStartedAt;
    timings.totalMs = Date.now() - pipelineStartedAt;
    await failClaim(claim, workerId, error, { phase: "normalization", timings });
    return;
  }
  timings.normalizationMs = Date.now() - normalizationStartedAt;
  logPhase(claim.sourceKey, "normalization", timings.normalizationMs);
  const baseNormalizedProduct: CrawlProduct = {
    ...normalization.normalizedProduct,
    sourceKey: claim.sourceKey,
  };
  const assetsNormalized = normalization.assetsNormalized;
  await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/seo`, {
    workerId,
    normalizedProduct: baseNormalizedProduct,
    seo: { status: "running" },
  });

  const heartbeat = setInterval(() => {
    void postJson<{ status: string }>(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/heartbeat`, {
      workerId,
    }).then((response) => {
      if (response.status === "cancelled") cancellationController.abort();
    }).catch((error: unknown) => {
      if (error instanceof CoordinatorRequestError && [404, 409].includes(error.status)) {
        cancellationController.abort();
      }
    });
  }, 2_000);
  heartbeat.unref();

  let reservedSeo:
    | {
        readonly input: ReturnType<typeof fromCustomizationProduct>;
        readonly execution: Awaited<ReturnType<typeof runSeoContentDetailed>>;
      }
    | undefined;
  let hasStartedShopifyWrite = false;
  try {
    throwIfCancelled();
    const claimStoreId = typeof claim.settings?.storeId === "string" && claim.settings.storeId.trim()
      ? claim.settings.storeId.trim()
      : storeId;
    const claimStoreConfig = configuredStores.find((store) => store.storeId === claimStoreId);
    const claimAdminHandle = claimStoreConfig?.shopDomain
      ? claimStoreConfig.shopDomain.replace(/\.myshopify\.com$/i, "")
      : claimStoreId;
    const targetProxyStores = configuredStores.filter(
      (store) => store.storeId.startsWith(`${claimStoreId}--`) && store.proxy?.url && store.proxy.failClosed !== false,
    );
    const assignedProxyStore = targetProxyStores.find(
      (store) => store.storeId === proxyStoreId || store.storeId.endsWith(`--${proxyProfile}`),
    );
    const effectiveProxyStoreId = assignedProxyStore?.storeId
      ?? targetProxyStores[0]?.storeId
      ?? claimStoreId;

    const priceAddition = Number(claim.settings?.priceAddition ?? 0);
    const discountPercent = Number(claim.settings?.discountPercent ?? 0);
    const rawCollectionIds = Array.isArray(claim.settings?.collectionIds)
      ? (claim.settings.collectionIds as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    const legacyCollectionId = typeof claim.settings?.collectionId === "string" && claim.settings.collectionId.trim()
      ? claim.settings.collectionId.trim()
      : undefined;
    if (legacyCollectionId && !rawCollectionIds.includes(legacyCollectionId)) {
      rawCollectionIds.unshift(legacyCollectionId);
    }
    const collectionIds = Array.from(new Set(rawCollectionIds));
    const customProductType = typeof claim.settings?.productType === "string" && claim.settings.productType.trim()
      ? claim.settings.productType.trim()
      : undefined;

    const runner = createModuleApiRunner({
      gatewayUrl,
      timeoutMs: 180_000,
      gatewayAuthToken: env.GATEWAY_AUTH_TOKEN,
    });
    const reconciliationWarnings: string[] = [];
    const resolveStartedAt = Date.now();
    const resolvedProduct = await resolveShopifyProductForSync({
      runner,
      storeId: effectiveProxyStoreId,
      sourceKey: claim.sourceKey,
      mappedProductId: claim.existingShopify?.productId,
    });
    throwIfCancelled();
    timings.shopifyResolveMs = Date.now() - resolveStartedAt;
    logPhase(claim.sourceKey, "shopify-resolve", timings.shopifyResolveMs);
    if (resolvedProduct.staleMappedProductId && resolvedProduct.match === "source_tag") {
      reconciliationWarnings.push(
        `Stored Shopify product ${resolvedProduct.staleMappedProductId} was missing; recovered source product as ${resolvedProduct.product?.id ?? "unknown"}.`,
      );
    } else if (resolvedProduct.staleMappedProductId && resolvedProduct.match === "none") {
      reconciliationWarnings.push(
        `Stored Shopify product ${resolvedProduct.staleMappedProductId} was missing; created a replacement product.`,
      );
    }
    let existingProductId = resolvedProduct.product?.id;
    let existingProductHandle = resolvedProduct.product?.handle;
    let existingManagedResources: ShopifyManagedResources | undefined = resolvedProduct.match === "mapping"
      ? claim.existingShopify?.managedResources
      : resolvedProduct.product
        ? {
            tags: resolvedProduct.product.tags,
            mediaIds: resolvedProduct.product.images?.flatMap((media) => media.id ? [media.id] : []) ?? [],
            variantIds: resolvedProduct.product.variants.map((variant) => variant.id),
          }
        : undefined;
    const lastSyncedChecksum = existingProductId
      ? claim.existingShopify?.normalizedChecksum
      : undefined;

    interface PreparedSeo {
      readonly input: ReturnType<typeof fromCustomizationProduct>;
      readonly execution: Awaited<ReturnType<typeof runSeoContentDetailed>>;
      readonly product: CrawlProduct;
    }
    let prepared: SeoCorpusCommitResult<PreparedSeo>;
    try {
      prepared = await seoCorpusCommitCoordinator.prepare<PreparedSeo>({
        signal: cancellationController.signal,
        runSeo: async () => {
          const input = {
            ...fromCustomizationProduct(baseNormalizedProduct),
            siteDomain: claimStoreConfig?.shopDomain,
          };
          const execution = await runSeoContentDetailed(input, {
            imageMode: "alt_only",
            signal: cancellationController.signal,
          });
          const product = applySeoContentToCustomizationProduct(
            baseNormalizedProduct,
            execution.output,
            { ensureUniqueHandle: true, existingShopifyHandle: existingProductHandle },
          );
          const finalHandle = String(product.handle || execution.output.productHandle);
          return {
            input: {
              ...fromCustomizationProduct(product),
              siteDomain: claimStoreConfig?.shopDomain,
            },
            execution: {
              ...execution,
              output: { ...execution.output, productHandle: finalHandle },
            },
            product,
          };
        },
        register: async (seo) => registerSeoContentKeywords(seo.input, seo.execution),
      });
      throwIfCancelled();
      reservedSeo = {
        input: prepared.execution.input,
        execution: prepared.execution.execution,
      };
    } catch (error: unknown) {
      if (cancellationController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new PipelineCancelledError();
      }
      timings.totalMs = Date.now() - pipelineStartedAt;
      await failClaim(claim, workerId, error, { retryable: true, phase: "seo", timings });
      return;
    }
    timings.seoInitialMs = prepared.timings.initialSeoMs;
    timings.seoQueueWaitMs = prepared.timings.queueWaitMs;
    timings.seoRebaseMs = prepared.timings.rebaseSeoMs;
    timings.seoRegistrationMs = prepared.timings.registrationMs;
    timings.seoTotalMs = prepared.timings.totalMs;
    if (prepared.revisionRetries > 0) {
      reconciliationWarnings.push(
        `SEO corpus changed during processing; regenerated SEO ${prepared.revisionRetries} time(s) before Shopify sync.`,
      );
    }
    logPhase(claim.sourceKey, "seo-and-corpus", timings.seoTotalMs);

    const seoProduct = prepared.execution.product;
    const seoExecution = prepared.execution.execution;
    const storeVendor = (claimStoreId.split("--")[0] || claimStoreId).trim().toUpperCase();
    const seoSummary = createSeoContentPipelineSummary(seoExecution);
    const imageProfileSlug = claim.settings.imageProfileSlug || "default";
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/image-processing`, {
      workerId,
      normalizedProduct: seoProduct,
      imageProcessing: { status: "running", profileSlug: imageProfileSlug },
    });

    const imageStartedAt = Date.now();
    let imageResponse: ImageProcessingResponse;
    try {
      imageResponse = await postJson<ImageProcessingResponse>("/api/v1/internal/image-processing/process", {
        product: seoProduct,
        profileSlug: imageProfileSlug,
        profileRevision: claim.settings.imageProfileRevision,
      }, cancellationController.signal);
    } catch (error: unknown) {
      if (cancellationController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new PipelineCancelledError();
      }
      timings.imageProcessingMs = Date.now() - imageStartedAt;
      timings.totalMs = Date.now() - pipelineStartedAt;
      await failClaim(claim, workerId, error, { retryable: true, phase: "image_processing", timings });
      return;
    }
    timings.imageProcessingMs = Date.now() - imageStartedAt;
    throwIfCancelled();
    const finalChecksum = checksum({
      product: seoProduct,
      imageProfileRevision: imageResponse.profile.revision,
      customProductType: customProductType ?? null,
      collectionIds: [...collectionIds].sort(),
      priceAddition,
      discountPercent,
      storeVendor,
    });
    const isNoOp = Boolean(existingProductId && lastSyncedChecksum === finalChecksum);
    let shopifyProduct = imageResponse.product;
    if (isNoOp) {
      shopifyProduct = stripProcessingTokens(shopifyProduct);
    }
    if (!isNoOp && imageResponse.profile.enabled) {
      const uploadStartedAt = Date.now();
      try {
        shopifyProduct = await stageProcessedMedia(
          imageResponse.product,
          runner,
          effectiveProxyStoreId,
          `pipeline-${claim.id}-${finalChecksum}`,
          cancellationController.signal,
        );
      } catch (error: unknown) {
        if (cancellationController.signal.aborted || error instanceof PipelineCancelledError) throw error;
        timings.imageUploadMs = Date.now() - uploadStartedAt;
        timings.totalMs = Date.now() - pipelineStartedAt;
        await failClaim(claim, workerId, error, { retryable: true, phase: "image_processing", timings });
        return;
      }
      timings.imageUploadMs = Date.now() - uploadStartedAt;
      throwIfCancelled();
    }
    const imageProcessingSummary = {
      status: "completed",
      profileSlug: imageResponse.profile.slug,
      profileRevision: imageResponse.profile.revision,
      processedImages: imageResponse.processed,
    } as const;
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/image-processing`, {
      workerId,
      normalizedProduct: shopifyProduct,
      imageProcessing: imageProcessingSummary,
    });
    logPhase(claim.sourceKey, "image-processing", timings.imageProcessingMs + (timings.imageUploadMs ?? 0));
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/syncing`, {
      workerId,
      normalizedProduct: shopifyProduct,
      proxyProfile,
      seo: seoSummary,
    });

    let syncResult: ShopifySyncProductResult;
    const syncStartedAt = Date.now();
    if (isNoOp) {
      syncResult = {
        success: true,
        sourceId: shopifyProduct.id,
        productId: existingProductId,
        productHandle: existingProductHandle,
        title: shopifyProduct.title || shopifyProduct.sourceTitle || "Custom Product",
        variantsCount: Array.isArray(shopifyProduct.variants) ? shopifyProduct.variants.length : 0,
        mediaCount: Array.isArray(shopifyProduct.media) ? shopifyProduct.media.length : 0,
        assetsUploadedCount: 0,
        metafieldSet: Boolean(shopifyProduct.customization),
        dryRun: false,
        warnings: [],
        managedResources: existingManagedResources,
        timings: {
          productWriteMs: 0,
          variantsMs: 0,
          assetUploadMs: 0,
          metafieldMs: 0,
          totalMs: 0,
        },
      };
    } else {
      const gateway = createShopifyGatewayAdapter(effectiveProxyStoreId, {
        runner,
        mode: "apply",
        getRequestId: (operation) => `pipeline-${claim.id}-${finalChecksum}-${operation}`,
      });
      hasStartedShopifyWrite = true;
      const baseInput = fromCustomizationNormalizerProduct(shopifyProduct, {
        vendor: storeVendor,
        productType: customProductType,
      });
      let syncInput: ShopifySyncProductInput = {
        ...baseInput,
        vendor: storeVendor,
        collectionsToJoin: collectionIds,
        ...(customProductType ? { productType: customProductType } : {}),
      };

      if ((priceAddition > 0 || discountPercent > 0) && baseInput.variants && baseInput.variants.length > 0) {
        const adjustedVariants = baseInput.variants.map((v) => {
          const rawPrice = Number.parseFloat(v.price);
          if (!Number.isFinite(rawPrice)) return v;
          const sellingPrice = rawPrice + priceAddition;
          let compareAtPrice: string | undefined = v.compareAtPrice;
          if (discountPercent > 0 && discountPercent < 100) {
            const calcCompare = sellingPrice / (1 - discountPercent / 100);
            compareAtPrice = calcCompare.toFixed(2);
          }
          return {
            ...v,
            price: sellingPrice.toFixed(2),
            compareAtPrice,
          };
        });
        syncInput = {
          ...syncInput,
          variants: adjustedVariants,
        };
      }

      syncResult = await syncSingleProduct(syncInput, {
        gateway,
        existingProductId,
        existingManagedResources,
        signal: cancellationController.signal,
      });
      throwIfCancelled();
    }

    if (syncResult.success && syncResult.productId && collectionIds.length > 0) {
      for (const colId of collectionIds) {
        try {
          throwIfCancelled();
          await runner({
            storeId: effectiveProxyStoreId,
            operation: "collections.updateMembership",
            payload: {
              collectionId: colId,
              productIdsToAdd: [syncResult.productId],
            },
            mode: "apply",
            requestId: `pipeline-${claim.id}-${finalChecksum}-collection-${colId}`,
          });
          console.log(`[Shopify pipeline] Attached product ${syncResult.productId} to collection ${colId}`);
        } catch (collectionError: unknown) {
          const msg = collectionError instanceof Error ? collectionError.message : String(collectionError);
          console.warn(`[Shopify pipeline] Non-fatal: Failed to attach product to collection ${colId}: ${msg}`);
        }
      }
    }

      if (!syncResult.success) {
        if (isProxyOrNetworkFailure(syncResult.error || "")) {
          proxyCooldownUntil.set(effectiveProxyStoreId, Date.now() + 30_000);
        }
        if (!syncResult.reconciliationRequired && reservedSeo) {
          await unregisterSeoContentKeywords(reservedSeo.input, reservedSeo.execution);
          reservedSeo = undefined;
        }
        timings.shopifySyncMs = Date.now() - syncStartedAt;
        timings.totalMs = Date.now() - pipelineStartedAt;
        await failClaim(claim, workerId, new Error(syncResult.error || "Shopify sync failed."), {
          retryable: !syncResult.reconciliationRequired,
          reconciliationRequired: syncResult.reconciliationRequired,
          phase: "shopify",
          timings,
        });
        return;
      }
    timings.shopifySyncMs = Date.now() - syncStartedAt;
    logPhase(claim.sourceKey, "shopify-sync", timings.shopifySyncMs);

    if (syncResult.productId) {
      throwIfCancelled();
      await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/shopify-checkpoint`, {
        workerId,
        storeId: claimStoreId,
        normalizedChecksum: finalChecksum,
        shopify: {
          productId: syncResult.productId,
          productHandle: syncResult.productHandle,
          managedResources: syncResult.managedResources ?? existingManagedResources ?? {},
        },
      });
    }
    existingProductId = syncResult.productId ?? existingProductId;
    existingProductHandle = syncResult.productHandle ?? existingProductHandle;
    existingManagedResources = syncResult.managedResources ?? existingManagedResources;
    timings.totalMs = Date.now() - pipelineStartedAt;

    throwIfCancelled();
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/complete`, {
      workerId,
      storeId: claimStoreId,
      normalizedChecksum: finalChecksum,
      normalizedProduct: shopifyProduct,
      shopify: {
        ...syncResult,
        seo: seoSummary,
        imageProcessing: imageProcessingSummary,
        noOp: isNoOp,
        warnings: [...syncResult.warnings, ...reconciliationWarnings],
        storeId: claimStoreId,
        adminUrl: existingProductId
          ? `https://admin.shopify.com/store/${claimAdminHandle}/products/${existingProductId.split("/").pop() ?? ""}`
          : undefined,
        attempts: claim.attempt,
        proxyProfile,
        assetsNormalized,
        timings: { pipeline: timings, shopify: syncResult.timings },
        managedResources: existingManagedResources ?? {},
      },
    });
    logPhase(claim.sourceKey, "total", timings.totalMs);
  } catch (error: unknown) {
    if (error instanceof PipelineCancelledError || cancellationController.signal.aborted) {
      if (reservedSeo && !hasStartedShopifyWrite) {
        await unregisterSeoContentKeywords(reservedSeo.input, reservedSeo.execution).catch(() => undefined);
      }
      await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/cancelled`, {
        workerId,
      }).catch(() => undefined);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isProxyOrNetworkFailure(message)) {
      proxyCooldownUntil.set(proxyStoreId, Date.now() + 30_000);
    }
    const reconciliationRequired = /unknown write state|partial write|reconciliation/i.test(message);
    if (reservedSeo && !hasStartedShopifyWrite) {
      await unregisterSeoContentKeywords(reservedSeo.input, reservedSeo.execution).catch(() => undefined);
    }
    timings.totalMs = Date.now() - pipelineStartedAt;
    await failClaim(claim, workerId, error, {
      retryable: !reconciliationRequired,
      reconciliationRequired,
      phase: "shopify",
      timings,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function workerLoop(workerIndex: number): Promise<void> {
  const proxyStore = proxyStores[workerIndex % proxyStores.length];
  const proxyProfile = proxyStore.storeId.slice(`${storeId}--`.length);
  const workerId = `${hostname()}-${process.pid}-${workerIndex + 1}`;
  for (;;) {
    try {
      const cooldownRemaining = (proxyCooldownUntil.get(proxyStore.storeId) ?? 0) - Date.now();
      if (cooldownRemaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(cooldownRemaining, 5_000)));
        continue;
      }
      const claimed = await postJson<ClaimResponse>("/api/v1/internal/product-pipeline/claim", {
        workerId,
        storeId,
        limit: 1,
      });
      const claim = claimed.items[0];
      if (!claim) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      await processClaim(claim, workerId, proxyStore.storeId, proxyProfile);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Shopify pipeline ${workerIndex + 1}] ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

async function waitForCoordinator(): Promise<void> {
  let lastError = "Coordinator is not ready.";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${coordinatorUrl}/api/v1/health`);
      const payload: unknown = await response.json().catch(() => null);
      const health = payload && typeof payload === "object"
        ? payload as { status?: unknown; apiVersion?: unknown }
        : null;
      if (
        response.ok
        && health?.status === "ok"
        && health.apiVersion === "v1"
      ) {
        return;
      }
      if (response.ok && health?.status === "ok") {
        throw new Error(
          `Coordinator at ${coordinatorUrl} does not expose the required API v1 health contract.`,
        );
      }
      lastError = `Coordinator health returned HTTP ${response.status}.`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/protocol .* is running/i.test(message)) throw error;
      lastError = message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Coordinator did not become ready at ${coordinatorUrl}: ${lastError}`);
}

function stop(): void {
  gatewayServer?.close();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main(): Promise<void> {
  await waitForCoordinator();
  console.log(
    `[Shopify pipeline] ${workerCount} workers, ${proxyStores.length} fail-closed proxy profiles, store ${storeId}.`,
  );
  const workers = Array.from({ length: workerCount }, (_, index) => workerLoop(index));
  await Promise.all(workers);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Shopify pipeline] ${message}`);
  gatewayServer?.close();
  process.exitCode = 1;
});
