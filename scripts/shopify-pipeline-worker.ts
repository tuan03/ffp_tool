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
} from "../src/modules/module-api";
import {
  fromCustomizationNormalizerProduct,
  syncSingleProduct,
} from "../src/modules/shopify-sync";

interface PipelineClaim {
  readonly id: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly sourceKey: string;
  readonly productId: string;
  readonly checksum: string;
  readonly attempt: number;
  readonly product: CrawlProduct;
  readonly existingShopify: {
    readonly productId: string;
    readonly productHandle?: string;
    readonly normalizedChecksum: string;
    readonly managedResources?: Record<string, unknown>;
  } | null;
}

interface ClaimResponse {
  readonly items: readonly PipelineClaim[];
}

const env = loadLocalEnv();
env.SHOPIFY_PROXY_CONFIG = env.SHOPIFY_PROXY_CONFIG || env.AMAZON_CRAWLER_PROXY_CONFIG || "config/amazon-crawler-profiles.json";
process.env.SHOPIFY_PROXY_CONFIG = env.SHOPIFY_PROXY_CONFIG;
const coordinatorUrl = (env.SHOPIFY_PIPELINE_COORDINATOR_URL || "http://127.0.0.1:8766").replace(/\/+$/, "");
const pipelineToken = env.SHOPIFY_PIPELINE_TOKEN?.trim();
const storeId = env.GATEWAY_STORE_ID?.trim();
const workerCount = Math.max(1, Math.min(16, Number(env.SHOPIFY_PIPELINE_WORKERS || 4)));
const gatewayPort = Math.max(1, Number(env.GATEWAY_PORT || 3001));
const gatewayUrl = (env.SHOPIFY_GATEWAY_URL || `http://127.0.0.1:${gatewayPort}/api/shopify`).replace(/\/+$/, "");
const proxyCooldownUntil = new Map<string, number>();

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
  gatewayServer = startGatewayServer({ port: gatewayPort, host: "127.0.0.1" });
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

async function postJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetch(`${coordinatorUrl}${path}`, {
    method: "POST",
    headers: pipelineHeaders(),
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail)
      : `Coordinator returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload as TResponse;
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
  options?: { readonly retryable?: boolean; readonly reconciliationRequired?: boolean },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/fail`, {
    workerId,
    storeId,
    error: { message },
    retryable: options?.retryable ?? false,
    reconciliationRequired: options?.reconciliationRequired ?? false,
  });
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
  const blockers = productBlockers(claim.product);
  if (blockers.length > 0) {
    await failClaim(claim, workerId, new Error(blockers.join(" ")));
    return;
  }

  let normalization: ReturnType<typeof normalizeCustomizationProduct>;
  try {
    normalization = normalizeCustomizationProduct(claim.product);
  } catch (error: unknown) {
    await failClaim(claim, workerId, error);
    return;
  }
  const normalizedProduct: CrawlProduct = {
    ...normalization.normalizedProduct,
    sourceKey: claim.sourceKey,
  };
  const assetsNormalized = normalization.assetsNormalized;
  const normalizedChecksum = checksum(normalizedProduct);
  const runner = createModuleApiRunner({ gatewayUrl, timeoutMs: 180_000 });
  let resolvedProduct: Awaited<ReturnType<typeof resolveShopifyProductForSync>>;
  try {
    resolvedProduct = await resolveShopifyProductForSync({
      runner,
      storeId: proxyStoreId,
      sourceKey: claim.sourceKey,
      mappedProductId: claim.existingShopify?.productId,
    });
  } catch (error: unknown) {
    await failClaim(claim, workerId, error, { retryable: true });
    return;
  }
  const reconciliationWarnings: string[] = [];
  if (resolvedProduct.staleMappedProductId && resolvedProduct.match === "source_tag") {
    reconciliationWarnings.push(
      `Stored Shopify product ${resolvedProduct.staleMappedProductId} was missing; recovered source product as ${resolvedProduct.product?.id ?? "unknown"}.`,
    );
  } else if (resolvedProduct.staleMappedProductId && resolvedProduct.match === "none") {
    reconciliationWarnings.push(
      `Stored Shopify product ${resolvedProduct.staleMappedProductId} was missing; created a replacement product.`,
    );
  }

  if (
    claim.existingShopify?.normalizedChecksum === normalizedChecksum
    && resolvedProduct.product
  ) {
    const resolvedId = resolvedProduct.product.id;
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/complete`, {
      workerId,
      storeId,
      normalizedChecksum,
      normalizedProduct,
      shopify: {
        storeId,
        productId: resolvedId,
        productHandle: resolvedProduct.product.handle,
        adminUrl: `https://admin.shopify.com/store/${shopAdminHandle}/products/${resolvedId.split("/").pop() ?? ""}`,
        noOp: true,
        attempts: claim.attempt,
        proxyProfile,
        warnings: reconciliationWarnings,
        assetsNormalized,
        managedResources: resolvedProduct.match === "mapping"
          ? claim.existingShopify.managedResources ?? {}
          : {
              tags: resolvedProduct.product.tags,
              mediaIds: resolvedProduct.product.images?.flatMap((media) => media.id ? [media.id] : []) ?? [],
              variantIds: resolvedProduct.product.variants.map((variant) => variant.id),
            },
      },
    });
    return;
  }

  await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/syncing`, {
    workerId,
    normalizedProduct,
    proxyProfile,
  });

  const heartbeat = setInterval(() => {
    void postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/heartbeat`, {
      workerId,
    }).catch(() => undefined);
  }, 30_000);
  heartbeat.unref();

  try {
    const reconciledProduct = resolvedProduct.product;
    const existingProductId = reconciledProduct?.id;
    const gateway = createShopifyGatewayAdapter(proxyStoreId, {
      runner,
      mode: "apply",
      getRequestId: (operation) => `pipeline-${claim.id}-${operation}`,
    });
    const syncInput = fromCustomizationNormalizerProduct(normalizedProduct);
    const existingManagedResources = resolvedProduct.match === "mapping"
      ? claim.existingShopify?.managedResources
      : (
      reconciledProduct
        ? {
            tags: reconciledProduct.tags,
            mediaIds: reconciledProduct.images?.flatMap((media) => media.id ? [media.id] : []) ?? [],
            variantIds: reconciledProduct.variants.map((variant) => variant.id),
          }
        : undefined
      );
    const syncResult = await syncSingleProduct(syncInput, {
      gateway,
      existingProductId,
      existingManagedResources,
    });
    if (!syncResult.success) {
      if (isProxyOrNetworkFailure(syncResult.error || "")) {
        proxyCooldownUntil.set(proxyStoreId, Date.now() + 30_000);
      }
      await failClaim(claim, workerId, new Error(syncResult.error || "Shopify sync failed."), {
        retryable: !syncResult.reconciliationRequired,
        reconciliationRequired: syncResult.reconciliationRequired,
      });
      return;
    }
    await postJson(`/api/v1/internal/product-pipeline/${encodeURIComponent(claim.id)}/complete`, {
      workerId,
      storeId,
      normalizedChecksum,
      normalizedProduct,
      shopify: {
        ...syncResult,
        warnings: [...syncResult.warnings, ...reconciliationWarnings],
        storeId,
        adminUrl: syncResult.productId
          ? `https://admin.shopify.com/store/${shopAdminHandle}/products/${syncResult.productId.split("/").pop() ?? ""}`
          : undefined,
        attempts: claim.attempt,
        proxyProfile,
        assetsNormalized,
        managedResources: syncResult.managedResources ?? {},
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isProxyOrNetworkFailure(message)) {
      proxyCooldownUntil.set(proxyStoreId, Date.now() + 30_000);
    }
    const reconciliationRequired = /unknown write state|partial write|reconciliation/i.test(message);
    await failClaim(claim, workerId, error, {
      retryable: !reconciliationRequired,
      reconciliationRequired,
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
      if (
        response.ok
        && payload
        && typeof payload === "object"
        && (payload as { protocolVersion?: unknown }).protocolVersion === "2"
      ) {
        return;
      }
      const protocolVersion = payload && typeof payload === "object"
        ? String((payload as { protocolVersion?: unknown }).protocolVersion ?? "unknown")
        : "unknown";
      if (response.ok && protocolVersion !== "2") {
        throw new Error(
          `Coordinator protocol ${protocolVersion} is running at ${coordinatorUrl}; protocol 2 is required. Stop the old dev process and restart npm run dev.`,
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
