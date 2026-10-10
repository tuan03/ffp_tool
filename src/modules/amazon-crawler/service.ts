import { readSeoReviewListPage } from "../../shared/seo-review-list";

import type {
  AmazonAsinChecker,
  AmazonAsinPreflightResult,
  ShopifyAsinFilter,
  ShopifyAsinFilterMatch,
  AmazonCrawlerInput,
  AmazonCrawlerDeadLetterActionInput,
  AmazonCrawlerDeadLetterActionResult,
  AmazonCrawlerDeadLetterPage,
  AmazonCrawlerTaskAttempt,
  AmazonCrawlerAgentRelease,
  AmazonCrawlerAgentRuntimeConfig,
  AmazonCrawlerAgentReleaseLoader,
  AmazonCrawlerCacheClearer,
  AmazonCrawlerCacheClearResult,
  AmazonCrawlerClientSummary,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerCommandController,
  AmazonCrawlerPendingPurgePreview,
  AmazonCrawlerAdmissionGate,
  AmazonCrawlerAdmissionGateController,
  AmazonCrawlerHydratedJob,
  AmazonCrawlerJobExecutionState,
  AmazonCrawlerJobLoader,
  AmazonCrawlerJobSnapshot,
  AmazonCrawlerJobController,
  AmazonCrawlerJobSummary,
  AmazonCrawlerSeoQueueHandoffSummary,
  AmazonCrawlerOutput,
  AmazonCrawlerProduct,
  AmazonCrawlerProgress,
  AmazonCrawlerReviewClient,
  AmazonCrawlerReviewDecision,
  AmazonCrawlerReviewEditPatch,
  AmazonCrawlerReviewItem,
  AmazonCrawlerRunOptions,
  AmazonCrawlerRunner,
  AmazonCrawlerSettings,
  AmazonCrawlerStatistics,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfile,
  ImageProcessingProfileManager,
} from "./types";
import { DEFAULT_AMAZON_CRAWLER_AGENT_CONFIG, DEFAULT_AMAZON_CRAWLER_SETTINGS, SHOPIFY_ASIN_FILTER_LIMIT } from "./types";
import { readCrawlerMetrics, readCrawlerTrace } from "./observability-response";

interface JobCreatedResponse {
  jobId: string;
}

export async function discoverCrawlerOperatorAuth(engineUrl: string, fetchImplementation: typeof fetch = fetch): Promise<boolean> {
  const baseUrl = engineUrl.replace(/\/+$/, "");
  const requestOptions = { redirect: "error" as const, cache: "no-store" as const, signal: AbortSignal.timeout(8000) };
  let response = await fetchImplementation(`${baseUrl}/api/v1/operator/security`, requestOptions);
  if (response.status === 404) {
    response = await fetchImplementation(`${baseUrl}/api/v1/worker/security`, requestOptions);
  }
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("Không kiểm tra được chế độ xác thực Coordinator.");
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.authRequired !== "boolean" || payload.authProtocol !== 1) {
    throw new Error("Coordinator trả contract xác thực không hợp lệ.");
  }
  return payload.authRequired;
}

export function createCrawlerOperatorFetch(options: {
  engineUrl: string; username: string; password: string;
  fetchImplementation?: typeof fetch; sessionSignal?: AbortSignal;
  onUnauthorized?: () => void;
}): typeof fetch {
  const base = new URL(options.engineUrl || "/", typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))) {
    throw new Error("Operator credentials require HTTPS.");
  }
  const authorization = `Basic ${btoa(Array.from(new TextEncoder().encode(`${options.username}:${options.password}`), (byte) => String.fromCharCode(byte)).join(""))}`;
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input), base);
    if (target.origin !== base.origin || target.username || target.password
      || !/^\/api\/v1\/(clients|crawl-jobs|crawl-tasks|crawler-metrics|review-jobs|product-reviews|image-profiles|admission-gate|fleet-circuit-breaker|dead-letter|pinterest-jobs|agent-keys|asin-families)(\/|$)/.test(target.pathname)) {
      throw new Error("Operator credential destination rejected.");
    }
    options.sessionSignal?.throwIfAborted();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("Authorization", authorization);
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signals = [options.sessionSignal, requestSignal].filter((signal): signal is AbortSignal => signal != null);
    const response = await (options.fetchImplementation ?? fetch)(input instanceof Request ? input : target.href, {
      ...init, headers, redirect: "error", cache: "no-store",
      ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
    });
    if (response.status === 401) options.onUnauthorized?.();
    return response;
  };
}

export interface AgentKeySummary {
  id: string;
  name: string;
  status: string;
  agentId: string | null;
  maxWorkers: number;
  crawlers: string[];
  environment: string;
}

export async function requestAgentKeyManagement(options: {
  username: string;
  password: string;
  action: "list" | "create" | "rotate" | "revoke";
  keyId?: string;
  limit?: number;
  offset?: number;
  payload?: Readonly<Record<string, unknown>>;
  fetchImplementation?: typeof fetch;
}): Promise<{ keys: AgentKeySummary[]; total: number; key?: string }> {
  const suffix = options.action === "rotate" || options.action === "revoke"
    ? `/${encodeURIComponent(options.keyId ?? "")}/${options.action}` : "";
  const query = options.action === "list"
    ? `?limit=${Math.max(1, Math.min(100, options.limit ?? 50))}&offset=${Math.max(0, options.offset ?? 0)}`
    : "";
  const encoded = btoa(Array.from(new TextEncoder().encode(`${options.username}:${options.password}`),
    (byte) => String.fromCharCode(byte)).join(""));
  const response = await (options.fetchImplementation ?? fetch)(`/api/v1/agent-keys${suffix}${query}`, {
    method: options.action === "list" ? "GET" : "POST",
    headers: { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" },
    cache: "no-store",
    redirect: "error",
    ...(options.action === "list" ? {} : { body: JSON.stringify(options.payload ?? {}) }),
  });
  if (!response.ok) {
    throw new Error(`Agent key operation failed (HTTP ${response.status}). No automatic retry was made.`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("Invalid agent key response.");
  const keys: AgentKeySummary[] = [];
  if (Array.isArray(payload.keys)) {
    for (const key of payload.keys) {
      if (!isRecord(key) || typeof key.id !== "string" || typeof key.name !== "string" || typeof key.status !== "string"
        || typeof key.maxWorkers !== "number" || typeof key.environment !== "string"
        || !Array.isArray(key.crawlers) || !key.crawlers.every((crawler: unknown) => typeof crawler === "string")) {
        throw new Error("Invalid agent key metadata.");
      }
      keys.push({ id: key.id, name: key.name, status: key.status, agentId: typeof key.agentId === "string" ? key.agentId : null,
        maxWorkers: key.maxWorkers, environment: key.environment, crawlers: key.crawlers.filter((crawler: unknown): crawler is string => typeof crawler === "string") });
    }
  }
  return { keys, total: typeof payload.total === "number" && Number.isSafeInteger(payload.total) && payload.total >= 0 ? payload.total : keys.length,
    ...(typeof payload.key === "string" ? { key: payload.key } : {}) };
}
function readCacheClearResult(value: unknown): AmazonCrawlerCacheClearResult {
  if (!isRecord(value) || typeof value.removedFiles !== "number" || typeof value.removedBytes !== "number") {
    throw new AmazonCrawlerServiceError("Engine returned an invalid cache response.", "INVALID_ENGINE_RESPONSE");
  }
  return {
    removedFiles: value.removedFiles,
    removedBytes: value.removedBytes,
    ...(typeof value.requestedClients === "number" ? { requestedClients: value.requestedClients } : {}),
    ...(typeof value.respondedClients === "number" ? { respondedClients: value.respondedClients } : {}),
    ...(typeof value.failedClients === "number" ? { failedClients: value.failedClients } : {}),
    ...(typeof value.discardedJobs === "number" ? { discardedJobs: value.discardedJobs } : {}),
  };
}

interface AmazonCrawlerClientOptions {
  engineUrl: string;
  fetchImplementation?: typeof fetch;
  pollIntervalMs?: number;
}

interface AmazonCrawlerAgentReleaseOptions {
  releaseApiUrl: string;
  fetchImplementation?: typeof fetch;
}

const AGENT_INSTALLER_FILE_NAME = "FFP-Amazon-Crawler-Setup.exe";
const AGENT_INSTALLER_CHECKSUM_FILE_NAME = `${AGENT_INSTALLER_FILE_NAME}.sha256`;

export class AmazonCrawlerServiceError extends Error {
  public readonly code: string;
  public readonly status: number | null;

  public constructor(message: string, code: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "AmazonCrawlerServiceError";
    this.code = code;
    this.status = status;
  }
}

const AMAZON_ASIN_FAMILY_STATUSES = new Set([
  "available", "existing", "processing", "queue_cleared", "crawled_pending_sync", "reconciliation_required",
]);

function isAsinList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (asin) => typeof asin === "string" && /^[A-Z0-9]{10}$/.test(asin),
  );
}

function isAmazonAsinFamilyPreflight(value: unknown): boolean {
  return isRecord(value) && typeof value.parentAsin === "string" && /^[A-Z0-9]{10}$/.test(value.parentAsin) &&
    isAsinList(value.inputAsins) && isAsinList(value.memberAsins) && typeof value.isResolved === "boolean" &&
    (value.databaseStatus === null || typeof value.databaseStatus === "string") &&
    (value.jobId === null || typeof value.jobId === "string") &&
    typeof value.status === "string" && AMAZON_ASIN_FAMILY_STATUSES.has(value.status);
}

export function createAmazonAsinChecker(
  fetchImplementation: typeof fetch = fetch,
  coordinator?: { readonly engineUrl: string; readonly fetchImplementation?: typeof fetch },
): AmazonAsinChecker {
  return async (storeId, asins): Promise<AmazonAsinPreflightResult> => {
    let families: unknown = undefined;
    if (coordinator) {
      const coordinatorResponse = await (coordinator.fetchImplementation ?? fetchImplementation)(
        `${normalizeEngineUrl(coordinator.engineUrl)}/api/v1/asin-families/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeId, asins }),
        },
      );
      const coordinatorBody: unknown = await coordinatorResponse.json().catch(() => null);
      if (!coordinatorResponse.ok || !isRecord(coordinatorBody) || !Array.isArray(coordinatorBody.families)) {
        const error = isRecord(coordinatorBody) && typeof coordinatorBody.detail === "string"
          ? coordinatorBody.detail
          : "Không kiểm tra được family ASIN trong FFP.";
        throw new AmazonCrawlerServiceError(error, "AMAZON_FAMILY_PREFLIGHT_FAILED", coordinatorResponse.status);
      }
      families = coordinatorBody.families;
    }
    const response = await fetchImplementation("/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        operation: "products.preflightAmazonAsins",
        mode: "apply",
        requestId: `amazon-asin-preflight-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        payload: families === undefined ? { asins } : { asins, families },
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || body.success !== true || !isRecord(body.data)) {
      const error = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
        ? body.error.message
        : "Không kiểm tra được ASIN trên Shopify.";
      throw new AmazonCrawlerServiceError(error, "SHOPIFY_ASIN_PREFLIGHT_FAILED", response.status);
    }
    const preflight = body.data;
    if (typeof preflight.ready !== "boolean" || !Array.isArray(preflight.matches) ||
      !Array.isArray(preflight.families) || preflight.families.some((family) => !isAmazonAsinFamilyPreflight(family) ||
        (family.hasExistingFamilyProducts !== undefined && typeof family.hasExistingFamilyProducts !== "boolean") ||
        (family.recoveredStaleRegistry !== undefined && typeof family.recoveredStaleRegistry !== "boolean") ||
        (family.hasSyncedFamilyMembers !== undefined && typeof family.hasSyncedFamilyMembers !== "boolean") ||
        (family.inputSyncedAsins !== undefined && !isAsinList(family.inputSyncedAsins))) ||
      !isAsinList(preflight.allowedAsins) ||
      preflight.matches.some((match: unknown) => !isRecord(match) || typeof match.asin !== "string" ||
        typeof match.parentAsin !== "string" || typeof match.productId !== "string" ||
        typeof match.title !== "string" || typeof match.adminUrl !== "string")) {
      throw new AmazonCrawlerServiceError("Shopify trả về kết quả kiểm tra ASIN không hợp lệ.", "INVALID_ENGINE_RESPONSE");
    }
    return preflight as unknown as AmazonAsinPreflightResult;
  };
}

export function createShopifyAsinFilter(fetchImplementation: typeof fetch = fetch): ShopifyAsinFilter {
  return async ({ storeId, asins, signal, onProgress }) => {
    if (!storeId.trim() || asins.length === 0 || asins.length > SHOPIFY_ASIN_FILTER_LIMIT || asins.some((asin) => !/^[A-Z0-9]{10}$/.test(asin))) {
      throw new AmazonCrawlerServiceError(`Chọn store và nhập 1–${SHOPIFY_ASIN_FILTER_LIMIT} ASIN hợp lệ.`, "INVALID_ASIN_FILTER_INPUT");
    }
    signal?.throwIfAborted();
    const scanSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15 * 60 * 1000)]);
    const requestedAsins = [...new Set(asins)];
    const requestedSet = new Set(requestedAsins);
    const matches = new Map<string, ShopifyAsinFilterMatch>();
    const cursors = new Set<string>();
    let after: string | null = null;
    let shopDomain: string | undefined;
    let scannedProducts = 0;
    let pagesRead = 0;
    do {
      scanSignal.throwIfAborted();
      const response = await fetchImplementation("/api/shopify", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        signal: AbortSignal.any([scanSignal, AbortSignal.timeout(90_000)]),
        body: JSON.stringify({ storeId, operation: "products.metafieldPage", payload: { namespace: "custom", key: "amazon_asin", first: 200, after } }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || body.success !== true || body.storeId !== storeId || !isRecord(body.data)) {
        throw new AmazonCrawlerServiceError("Chưa xác minh được ASIN trên Shopify. Kiểm tra kết nối/quyền của store rồi thử lại; chưa thể kết luận ASIN nào chưa có.", "SHOPIFY_ASIN_FILTER_FAILED", response.status);
      }
      const page = body.data;
      if (page.namespace !== "custom" || page.key !== "amazon_asin" || typeof page.shopDomain !== "string" ||
        !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(page.shopDomain) || (shopDomain !== undefined && shopDomain !== page.shopDomain) ||
        !Array.isArray(page.products) || !isRecord(page.pageInfo) || typeof page.pageInfo.hasNextPage !== "boolean" ||
        (page.pageInfo.endCursor !== null && typeof page.pageInfo.endCursor !== "string")) {
        throw new AmazonCrawlerServiceError("Shopify trả dữ liệu kiểm tra không đầy đủ; chưa thể phân loại ASIN.", "INVALID_ASIN_FILTER_RESPONSE");
      }
      shopDomain = page.shopDomain;
      for (const product of page.products) {
        if (!isRecord(product) || typeof product.id !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(product.id) ||
          typeof product.title !== "string" || typeof product.status !== "string" || !["ACTIVE", "DRAFT", "ARCHIVED"].includes(product.status) ||
          (product.value !== null && typeof product.value !== "string")) {
          throw new AmazonCrawlerServiceError("Shopify trả dữ liệu sản phẩm không hợp lệ; chưa thể phân loại ASIN.", "INVALID_ASIN_FILTER_RESPONSE");
        }
        const asin = typeof product.value === "string" ? product.value.trim().toUpperCase() : "";
        if (requestedSet.has(asin) && !matches.has(asin)) {
          matches.set(asin, { asin, productId: product.id, title: product.title, status: product.status, adminUrl: `https://${shopDomain}/admin/products/${product.id.split("/").at(-1)}` });
        }
      }
      scannedProducts += page.products.length;
      pagesRead++;
      const next = page.pageInfo.endCursor;
      if (page.pageInfo.hasNextPage && (!next || typeof next !== "string" || cursors.has(next) || page.products.length === 0 || pagesRead >= 1000)) {
        throw new AmazonCrawlerServiceError("Chưa kiểm tra hết Shopify do lỗi phân trang hoặc vượt giới hạn quét; chưa thể kết luận ASIN chưa có.", "INVALID_ASIN_FILTER_PAGINATION");
      }
      if (typeof next === "string") cursors.add(next);
      onProgress?.({ scannedProducts, pagesRead });
      after = page.pageInfo.hasNextPage && matches.size !== requestedSet.size ? String(next) : null;
    } while (after !== null);
    scanSignal.throwIfAborted();
    return { storeId, matches: requestedAsins.flatMap((asin) => { const match = matches.get(asin); return match ? [match] : []; }), missingAsins: requestedAsins.filter((asin) => !matches.has(asin)), scannedProducts };
  };
}

function normalizeEngineUrl(engineUrl: string): string {
  return engineUrl.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadPagedJobProducts({
  baseUrl, jobId, fetchImplementation, knownProducts, knownStatuses, signal,
}: {
  baseUrl: string;
  jobId: string;
  fetchImplementation: typeof fetch;
  knownProducts: Map<string, AmazonCrawlerProduct>;
  knownStatuses: Map<string, string>;
  signal?: AbortSignal;
}): Promise<boolean> {
  const productUrl = `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/products`;
  let cursor: string | null = null;
  let hasNewProducts = false;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page = await readJson(await fetchImplementation(`${productUrl}${query}`, { signal }));
    if (!isRecord(page) || !Array.isArray(page.products)) {
      throw new AmazonCrawlerServiceError("Coordinator returned an invalid product page.", "INVALID_ENGINE_RESPONSE");
    }
    for (const entry of page.products) {
      if (!isRecord(entry) || typeof entry.id !== "string") continue;
      const status = typeof entry.status === "string" ? entry.status : "";
      if (knownProducts.has(entry.id) && knownStatuses.get(entry.id) === status) continue;
      const detailUrl = `${productUrl}/${encodeURIComponent(entry.id)}`;
      const detail = await readJson(await fetchImplementation(detailUrl, { signal }));
      if (!isRecord(detail) || typeof detail.id !== "string") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid product.", "INVALID_ENGINE_RESPONSE");
      }
      const variants: AmazonCrawlerProduct["variants"] = [];
      let variantCursor: number | null = 0;
      while (variantCursor !== null) {
        const variantPage = await readJson(await fetchImplementation(
          `${detailUrl}/variants?cursor=${variantCursor}`, { signal },
        ));
        if (!isRecord(variantPage) || !Array.isArray(variantPage.variants)) {
          throw new AmazonCrawlerServiceError("Coordinator returned an invalid variant page.", "INVALID_ENGINE_RESPONSE");
        }
        variants.push(...variantPage.variants as AmazonCrawlerProduct["variants"]);
        const nextVariantCursor = variantPage.nextCursor;
        if (nextVariantCursor !== null && nextVariantCursor !== undefined && (
          typeof nextVariantCursor !== "number" || !Number.isSafeInteger(nextVariantCursor) || nextVariantCursor <= variantCursor
        )) {
          throw new AmazonCrawlerServiceError("Coordinator returned a non-advancing variant cursor.", "INVALID_ENGINE_RESPONSE");
        }
        variantCursor = typeof nextVariantCursor === "number" ? nextVariantCursor : null;
      }
      knownProducts.set(entry.id, { ...detail, variants } as unknown as AmazonCrawlerProduct);
      knownStatuses.set(entry.id, status);
      hasNewProducts = true;
    }
    const nextCursor = page.nextCursor;
    if (nextCursor !== null && nextCursor !== undefined && (
      typeof nextCursor !== "string" || nextCursor.length === 0 || (cursor !== null && nextCursor <= cursor)
    )) {
      throw new AmazonCrawlerServiceError("Coordinator returned a non-advancing product cursor.", "INVALID_ENGINE_RESPONSE");
    }
    cursor = typeof nextCursor === "string" ? nextCursor : null;
  } while (cursor !== null);
  return hasNewProducts;
}

function readJobCreated(value: unknown): JobCreatedResponse {
  if (!isRecord(value) || (typeof value.id !== "string" && typeof value.jobId !== "string")) {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job response.", "INVALID_ENGINE_RESPONSE");
  }
  return { jobId: typeof value.id === "string" ? value.id : value.jobId as string };
}

interface CoordinatorSnapshot {
  id: string;
  status: AmazonCrawlerJobSnapshot["status"];
  executionState: AmazonCrawlerJobExecutionState;
  progress: AmazonCrawlerProgress;
}

function readSnapshot(value: unknown): CoordinatorSnapshot {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string" || !isRecord(value.progress)) {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job snapshot.", "INVALID_ENGINE_RESPONSE");
  }
  const completed = value.progress.completed;
  const total = value.progress.total;
  if (typeof completed !== "number" || typeof total !== "number") {
    throw new AmazonCrawlerServiceError("Engine returned invalid job progress.", "INVALID_ENGINE_RESPONSE");
  }
  const status = value.status as CoordinatorSnapshot["status"];
  const executionState = value.executionState === "pausing" || value.executionState === "paused"
    ? value.executionState
    : "active";
  const isTerminal = ["review_pending", "completed", "partial", "cancelled"].includes(status);
  return {
    id: value.id,
    status,
    executionState,
    progress: {
      phase: typeof value.progress.phase === "string" ? value.progress.phase as AmazonCrawlerProgress["phase"] : (isTerminal ? "export" : "product"),
      completed,
      total,
      message: typeof value.progress.message === "string"
        ? value.progress.message
        : (isTerminal ? `Đã xử lý ${completed}/${total} link.` : `Đang xử lý ${completed}/${total} link trên các client.`),
      currentAsin: typeof value.currentAsin === "string" ? value.currentAsin : undefined,
      errors: typeof value.errors === "number" ? value.errors : undefined,
      items: Array.isArray(value.progress.items) ? value.progress.items as AmazonCrawlerProgress["items"] : undefined,
      browserPool: isRecord(value.progress.browserPool) ? value.progress.browserPool as unknown as AmazonCrawlerProgress["browserPool"] : undefined,
    },
  };
}

function readSeoQueueHandoff(value: unknown): AmazonCrawlerSeoQueueHandoffSummary {
  if (!isRecord(value)) {
    return { totalProducts: 0, handedOver: 0, pending: 0, notHandedOver: 0 };
  }
  const totalProducts = typeof value.totalProducts === "number" ? value.totalProducts : 0;
  const handedOver = typeof value.handedOver === "number" ? value.handedOver : 0;
  const pending = typeof value.pending === "number" ? value.pending : 0;
  const notHandedOver = typeof value.notHandedOver === "number" ? value.notHandedOver : 0;
  return {
    totalProducts, handedOver, pending, notHandedOver,
    ...(typeof value.skippedExistingShopify === "number" ? { skippedExistingShopify: value.skippedExistingShopify } : {}),
    ...(typeof value.skippedExistingPipeline === "number" ? { skippedExistingPipeline: value.skippedExistingPipeline } : {}),
    ...(typeof value.totalDetected === "number" ? { totalDetected: value.totalDetected } : {}),
  };
}

function readJobSnapshot(value: unknown): AmazonCrawlerJobSnapshot {
  const core = readSnapshot(value);
  if (!isRecord(value)) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid job snapshot.", "INVALID_ENGINE_RESPONSE");
  }
  const cancellation = isRecord(value.cancellation) ? value.cancellation : {};
  const pendingAgents = Array.isArray(cancellation.pendingAgents)
    ? cancellation.pendingAgents.flatMap((pendingAgent) => {
        if (!isRecord(pendingAgent) || typeof pendingAgent.clientId !== "string") return [];
        return [{
          clientId: pendingAgent.clientId,
          displayName: typeof pendingAgent.displayName === "string" ? pendingAgent.displayName : pendingAgent.clientId,
          status: typeof pendingAgent.status === "string"
            ? pendingAgent.status as AmazonCrawlerClientSummary["status"]
            : "offline" as const,
          taskCount: typeof pendingAgent.taskCount === "number" ? pendingAgent.taskCount : 0,
          receivedTaskCount: typeof pendingAgent.receivedTaskCount === "number" ? pendingAgent.receivedTaskCount : 0,
          hasReceived: pendingAgent.hasReceived === true,
        }];
      })
    : [];
  const pendingPipeline = Array.isArray(cancellation.pendingPipeline)
    ? cancellation.pendingPipeline.flatMap((pendingItem) => {
        if (!isRecord(pendingItem) || typeof pendingItem.itemId !== "string" || typeof pendingItem.sourceKey !== "string") return [];
        return [{
          itemId: pendingItem.itemId,
          sourceKey: pendingItem.sourceKey,
          phase: typeof pendingItem.phase === "string"
            ? pendingItem.phase as AmazonCrawlerJobSnapshot["cancellation"]["pendingPipeline"][number]["phase"]
            : "pipeline" as const,
          workerId: typeof pendingItem.workerId === "string" ? pendingItem.workerId : null,
          receivedAt: typeof pendingItem.receivedAt === "string" ? pendingItem.receivedAt : null,
        }];
      })
    : [];
  const pendingCleanupAgents = Array.isArray(cancellation.pendingCleanupAgents)
    ? cancellation.pendingCleanupAgents.flatMap((pendingCleanup) => {
        if (!isRecord(pendingCleanup) || typeof pendingCleanup.clientId !== "string") return [];
        return [{
          clientId: pendingCleanup.clientId,
          displayName: typeof pendingCleanup.displayName === "string"
            ? pendingCleanup.displayName
            : pendingCleanup.clientId,
          status: typeof pendingCleanup.status === "string" ? pendingCleanup.status : "pending",
          error: typeof pendingCleanup.error === "string" ? pendingCleanup.error : null,
        }];
      })
    : [];
  return {
    jobId: core.id,
    status: core.status,
    executionState: core.executionState,
    progress: core.progress,
    result: null,
    error: null,
    inputs: Array.isArray(value.inputs) ? value.inputs.filter((input): input is string => typeof input === "string") : [],
    settings: isRecord(value.settings)
      ? { ...DEFAULT_AMAZON_CRAWLER_SETTINGS, ...value.settings } as AmazonCrawlerJobSnapshot["settings"]
      : DEFAULT_AMAZON_CRAWLER_SETTINGS,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    replacementOfJobId: typeof value.replacementOfJobId === "string" ? value.replacementOfJobId : null,
    cancellation: {
      id: typeof cancellation.id === "string" ? cancellation.id : null,
      requestedAt: typeof cancellation.requestedAt === "string" ? cancellation.requestedAt : null,
      pendingAgents,
      pendingPipeline,
      pendingPipelineItems: typeof cancellation.pendingPipelineItems === "number" ? cancellation.pendingPipelineItems : 0,
      pendingCleanupAgents,
      cacheGeneration: typeof cancellation.cacheGeneration === "number" ? cancellation.cacheGeneration : null,
      isExecutionConfirmed: cancellation.isExecutionConfirmed === true,
    },
    seoQueueHandoff: readSeoQueueHandoff(value.seoQueueHandoff),
  };
}

const AVAILABLE_CLIENT_STATUSES = new Set(["online", "busy", "waiting_captcha", "degraded"]);

function readClients(value: unknown): AmazonCrawlerClientSummary[] {
  if (!Array.isArray(value)) throw new AmazonCrawlerServiceError("Coordinator returned an invalid client list.", "INVALID_ENGINE_RESPONSE");
  return value.map((client) => {
    if (!isRecord(client) || typeof client.id !== "string" || typeof client.displayName !== "string" || typeof client.status !== "string") {
      throw new AmazonCrawlerServiceError("Coordinator returned an invalid client record.", "INVALID_ENGINE_RESPONSE");
    }
    return {
      id: client.id,
      displayName: client.displayName,
      agentGroup: typeof client.agentGroup === "string" ? client.agentGroup : "default",
      agentVersion: typeof client.agentVersion === "string" ? client.agentVersion : "unknown",
      status: client.status as AmazonCrawlerClientSummary["status"],
      isConnected: client.isConnected === true,
      maxConcurrentInputs: typeof client.maxConcurrentInputs === "number" ? client.maxConcurrentInputs : 0,
      activeTasks: typeof client.activeTasks === "number" ? client.activeTasks : 0,
      leasedTasks: typeof client.leasedTasks === "number" ? client.leasedTasks : 0,
      availableSlots: typeof client.availableSlots === "number" ? client.availableSlots : 0,
      lastSeenAt: typeof client.lastSeenAt === "string" ? client.lastSeenAt : null,
      desiredExecutionState: readExecutionState(client.desiredExecutionState),
      appliedExecutionState: readExecutionState(client.appliedExecutionState),
      commandSequence: typeof client.commandSequence === "number" ? client.commandSequence : 0,
      lastProcessedCommandSequence: typeof client.lastProcessedCommandSequence === "number" ? client.lastProcessedCommandSequence : 0,
      desiredConfigVersion: typeof client.desiredConfigVersion === "number" ? client.desiredConfigVersion : 0,
      appliedConfigVersion: typeof client.appliedConfigVersion === "number" ? client.appliedConfigVersion : 0,
      desiredAgentConfig: readAgentRuntimeConfig(client.desiredAgentConfig),
      observability: isRecord(client.observability) && isRecord(client.observability.workerHealth)
        ? {
          workerHealth: {
            state: client.observability.workerHealth.state === "degraded" ? "degraded" : "healthy",
            failuresInWindow: typeof client.observability.workerHealth.failuresInWindow === "number" ? client.observability.workerHealth.failuresInWindow : 0,
            failureLimit: typeof client.observability.workerHealth.failureLimit === "number" ? client.observability.workerHealth.failureLimit : 5,
            windowSeconds: typeof client.observability.workerHealth.windowSeconds === "number" ? client.observability.workerHealth.windowSeconds : 600,
            configuredConcurrency: typeof client.observability.workerHealth.configuredConcurrency === "number" ? client.observability.workerHealth.configuredConcurrency : 0,
            effectiveConcurrency: typeof client.observability.workerHealth.effectiveConcurrency === "number" ? client.observability.workerHealth.effectiveConcurrency : 0,
          },
        }
        : undefined,
    };
  });
}

function readExecutionState(value: unknown): AmazonCrawlerClientSummary["desiredExecutionState"] {
  return value === "PAUSED" || value === "DRAINING" || value === "DRAINED" ? value : "RUNNING";
}

function readAgentRuntimeConfig(value: unknown): AmazonCrawlerAgentRuntimeConfig {
  if (!isRecord(value) || !isRecord(value.limits)) return DEFAULT_AMAZON_CRAWLER_AGENT_CONFIG;
  const limits = value.limits;
  const numbers = [value.maxConcurrentInputs, value.heartbeatIntervalSeconds, value.clientOfflineAfterSeconds,
    value.leaseSeconds, limits.productThreads, limits.variantThreads, limits.urllibThreads,
    limits.browserProfiles, limits.browserTabs];
  if (!numbers.every((candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate))) {
    return DEFAULT_AMAZON_CRAWLER_AGENT_CONFIG;
  }
  if (typeof limits.headless !== "boolean") return DEFAULT_AMAZON_CRAWLER_AGENT_CONFIG;
  return value as unknown as AmazonCrawlerAgentRuntimeConfig;
}

export function createAmazonCrawlerCommandController({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerCommandController {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return {
    async submit(agentId, type) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type }),
      });
      await readJson(response);
    },
    async bulkCommand(agentGroup, type, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/bulk-commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type, agentGroup, reason }),
      });
      const payload: unknown = await readJson(response);
      if (!isRecord(payload) || typeof payload.requested !== "number"
          || typeof payload.queued !== "number" || typeof payload.failed !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid bulk-command response.", "INVALID_ENGINE_RESPONSE");
      }
      return { requested: payload.requested, queued: payload.queued, failed: payload.failed };
    },
    async previewPendingPurge(agentId, taskIds): Promise<AmazonCrawlerPendingPurgePreview> {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "PURGE_PENDING_TASKS",
          taskIds, dryRun: true }),
      });
      const payload: unknown = await readJson(response);
      if (!isRecord(payload) || payload.scope !== "pending" || !Array.isArray(payload.eligibleTaskIds)
          || typeof payload.requestedCount !== "number" || typeof payload.pendingCount !== "number"
          || typeof payload.ineligibleCount !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid pending-purge preview.", "INVALID_ENGINE_RESPONSE");
      }
      return { scope: "pending", requestedCount: payload.requestedCount, pendingCount: payload.pendingCount,
        ineligibleCount: payload.ineligibleCount,
        eligibleTaskIds: payload.eligibleTaskIds.filter((taskId): taskId is string => typeof taskId === "string") };
    },
    async purgePending(agentId, taskIds, expectedPendingCount, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "PURGE_PENDING_TASKS", taskIds,
          expectedPendingCount, confirmation: `PURGE_PENDING_TASKS:${expectedPendingCount}`, reason }),
      });
      await readJson(response);
    },
    async previewPurgeAllLocal(agentId): Promise<AmazonCrawlerPendingPurgePreview> {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "PURGE_ALL_LOCAL_TASKS", includeRunning: false, dryRun: true }),
      });
      const payload: unknown = await readJson(response);
      if (!isRecord(payload) || payload.scope !== "all-local" || !Array.isArray(payload.eligibleTaskIds)
          || typeof payload.pendingCount !== "number" || typeof payload.ineligibleCount !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid purge-all preview.", "INVALID_ENGINE_RESPONSE");
      }
      return { scope: "all-local", requestedCount: typeof payload.requestedCount === "number" ? payload.requestedCount : 0,
        pendingCount: payload.pendingCount, ineligibleCount: payload.ineligibleCount,
        eligibleTaskIds: payload.eligibleTaskIds.filter((taskId): taskId is string => typeof taskId === "string") };
    },
    async purgeAllLocal(agentId, expectedPendingCount, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "PURGE_ALL_LOCAL_TASKS",
          includeRunning: false, expectedPendingCount,
          confirmation: `PURGE_ALL_LOCAL_TASKS:${expectedPendingCount}`, reason }),
      });
      await readJson(response);
    },
    async restart(agentId, type, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type, reason,
          confirmation: `${type}:${agentId}`, expiresInSeconds: 600 }),
      });
      await readJson(response);
    },
    async reloadConfig(agentId, config) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "RELOAD_CONFIG", config }),
      });
      await readJson(response);
    },
    async drain(agentId, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "DRAIN", reason, expiresInSeconds: 86400 }),
      });
      await readJson(response);
    },
    async selfTest(agentId, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "RUN_SELF_TEST", reason }),
      });
      await readJson(response);
    },
    async updateAgent(agentId, targetVersion, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "UPDATE_AGENT", targetVersion, reason,
          expiresInSeconds: 86400 }),
      });
      await readJson(response);
    },
    async rollbackAgent(agentId, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type: "ROLLBACK_AGENT", reason,
          expiresInSeconds: 86400 }),
      });
      await readJson(response);
    },
    async history(agentId) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/${encodeURIComponent(agentId)}/commands?limit=20`);
      const payload: unknown = await readJson(response);
      if (!isRecord(payload) || !Array.isArray(payload.commands)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid command history.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.commands.filter((entry): entry is Record<string, unknown> => isRecord(entry)).map((entry) => ({
        commandId: typeof entry.commandId === "string" ? entry.commandId : "",
        sequence: typeof entry.sequence === "number" ? entry.sequence : 0,
        type: entry.type === "PAUSE" ? "PAUSE" as const
          : entry.type === "RELOAD_CONFIG" ? "RELOAD_CONFIG" as const
          : entry.type === "DRAIN" ? "DRAIN" as const
          : entry.type === "RUN_SELF_TEST" ? "RUN_SELF_TEST" as const
          : entry.type === "UPDATE_AGENT" ? "UPDATE_AGENT" as const
          : entry.type === "ROLLBACK_AGENT" ? "ROLLBACK_AGENT" as const
          : entry.type === "PURGE_PENDING_TASKS" ? "PURGE_PENDING_TASKS" as const
          : entry.type === "PURGE_ALL_LOCAL_TASKS" ? "PURGE_ALL_LOCAL_TASKS" as const
          : entry.type === "RESTART_WORKERS" ? "RESTART_WORKERS" as const
          : entry.type === "RESTART_AGENT" ? "RESTART_AGENT" as const : "RESUME" as const,
        status: typeof entry.status === "string" ? entry.status : "UNKNOWN",
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
        error: typeof entry.error === "string" ? entry.error : null,
        events: Array.isArray(entry.events) ? entry.events.filter((event): event is Record<string, unknown> => isRecord(event)).map((event) => ({
          status: typeof event.status === "string" ? event.status : "UNKNOWN",
          at: typeof event.at === "string" ? event.at : null,
          detail: isRecord(event.detail) ? event.detail : {},
        })) : [],
      })).filter((entry) => entry.commandId.length > 0);
    },
  };
}

function readAdmissionGate(value: unknown): AmazonCrawlerAdmissionGate {
  if (!isRecord(value) || (value.state !== "OPEN" && value.state !== "STOPPED")
    || value.scope !== "crawler" || typeof value.revision !== "number") {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid admission-gate response.", "INVALID_ENGINE_RESPONSE");
  }
  return {
    state: value.state,
    scope: "crawler",
    revision: value.revision,
    actor: typeof value.actor === "string" ? value.actor : null,
    reason: typeof value.reason === "string" ? value.reason : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    confirmedAgents: typeof value.confirmedAgents === "number" ? value.confirmedAgents : 0,
    pendingAgents: typeof value.pendingAgents === "number" ? value.pendingAgents : 0,
    confirmations: Array.isArray(value.confirmations) ? value.confirmations
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        agentId: typeof item.agentId === "string" ? item.agentId : "",
        displayName: typeof item.displayName === "string" ? item.displayName : "Unknown agent",
        isConnected: item.isConnected === true,
        state: item.state === "STOPPED" ? "STOPPED" as const : "OPEN" as const,
        revision: typeof item.revision === "number" ? item.revision : 0,
        status: item.status === "confirmed" ? "confirmed" as const : "pending_confirmation" as const,
      })).filter((item) => item.agentId.length > 0) : [],
  };
}

export function createAmazonCrawlerAdmissionGateController({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerAdmissionGateController {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return {
    async load() {
      const response = await fetchImplementation(`${baseUrl}/api/v1/admission-gate`, { cache: "no-store" });
      return readAdmissionGate(await readJson(response));
    },
    async setState(state, reason) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/admission-gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID().replaceAll("-", ""), state, reason }),
      });
      return readAdmissionGate(await readJson(response));
    },
  };
}

function readAgentRelease(value: unknown): AmazonCrawlerAgentRelease {
  if (isRecord(value) && isRecord(value.manifest) && isRecord(value.release)) {
    const manifest = value.manifest;
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
        typeof manifest.url !== "string" || typeof manifest.size !== "number" || manifest.size <= 0 ||
        typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
      throw new AmazonCrawlerServiceError("Invalid verified ZIP release.", "INVALID_AGENT_RELEASE_RESPONSE");
    }
    const url = new URL(manifest.url);
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname.endsWith(".zip")) {
      throw new AmazonCrawlerServiceError("Unsafe ZIP release URL.", "UNSAFE_AGENT_RELEASE_URL");
    }
    return {
      version: manifest.version, downloadUrl: url.toString(), checksumUrl: url.toString() + ".sha256",
      releasePageUrl: new URL(".", url).toString(), fileName: url.pathname.split("/").pop() ?? "agent.zip",
      sizeBytes: manifest.size, publishedAt: typeof manifest.publishedAt === "string" ? manifest.publishedAt : "",
    };
  }
  if (!isRecord(value) || typeof value.tag_name !== "string" ||
    typeof value.html_url !== "string" || typeof value.published_at !== "string" ||
    !Array.isArray(value.assets)) {
    throw new AmazonCrawlerServiceError(
      "GitHub returned invalid agent release metadata.",
      "INVALID_AGENT_RELEASE_RESPONSE",
    );
  }

  const versionMatch = /^agent-v(\d+\.\d+\.\d+)$/.exec(value.tag_name.trim());
  const installer = value.assets.find((asset) =>
    isRecord(asset) && asset.name === AGENT_INSTALLER_FILE_NAME
  );
  const checksum = value.assets.find((asset) =>
    isRecord(asset) && asset.name === AGENT_INSTALLER_CHECKSUM_FILE_NAME
  );
  if (!versionMatch || !isRecord(installer) || !isRecord(checksum) ||
    typeof installer.browser_download_url !== "string" ||
    typeof checksum.browser_download_url !== "string" ||
    typeof installer.size !== "number") {
    throw new AmazonCrawlerServiceError(
      "The latest GitHub release does not contain a valid Windows agent installer.",
      "AGENT_INSTALLER_NOT_FOUND",
    );
  }

  const downloadUrl = new URL(installer.browser_download_url);
  const checksumUrl = new URL(checksum.browser_download_url);
  const releasePageUrl = new URL(value.html_url);
  const urls = [downloadUrl, checksumUrl, releasePageUrl];
  if (urls.some((url) => url.protocol !== "https:" || url.hostname !== "github.com")) {
    throw new AmazonCrawlerServiceError(
      "The agent release contains an unsafe download URL.",
      "UNSAFE_AGENT_RELEASE_URL",
    );
  }

  return {
    version: versionMatch[1] ?? "",
    downloadUrl: downloadUrl.toString(),
    checksumUrl: checksumUrl.toString(),
    releasePageUrl: releasePageUrl.toString(),
    fileName: AGENT_INSTALLER_FILE_NAME,
    sizeBytes: installer.size,
    publishedAt: value.published_at,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : response.statusText;
    throw new AmazonCrawlerServiceError(detail || "Amazon crawler engine request failed.", "ENGINE_REQUEST_FAILED", response.status);
  }
  return body;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The crawler job was cancelled.", "AbortError"));
      return;
    }
    const timeoutId = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new DOMException("The crawler job was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export function createAmazonCrawlerRunner({
  engineUrl,
  fetchImplementation = fetch,
  pollIntervalMs = 700,
}: AmazonCrawlerClientOptions): AmazonCrawlerRunner {
  const baseUrl = normalizeEngineUrl(engineUrl);

  return async ({ input, onProgress, onProducts, onJobCreated, signal }: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> => {
    let jobId: string | null = null;
    let cancellationPromise: Promise<void> | null = null;
    const knownProducts = new Map<string, AmazonCrawlerProduct>();
    const knownStatuses = new Map<string, string>();
    let lastProductsRefreshAt = 0;

    const cancelJob = (): Promise<void> => {
      if (jobId === null) return Promise.resolve();
      if (cancellationPromise) return cancellationPromise;
      cancellationPromise = (async () => {
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/cancel`,
          { method: "POST" },
        );
        if (response.status === 404) return;
        await readJson(response);
      })();
      return cancellationPromise;
    };
    const handleAbort = (): void => {
      void cancelJob();
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
      if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
      const clientsResponse = await fetchImplementation(`${baseUrl}/api/v1/clients`, { signal }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new AmazonCrawlerServiceError("Không kết nối được coordinator. Hãy chạy npm run dev.", "COORDINATOR_OFFLINE");
      });
      const clients = readClients(await readJson(clientsResponse));
      if (!clients.some((client) => client.isConnected && AVAILABLE_CLIENT_STATUSES.has(client.status))) {
        throw new AmazonCrawlerServiceError("Chưa có máy crawler nào đang online. Hãy mở FFP Amazon Crawler Agent.", "NO_CLIENT_AVAILABLE");
      }
      let createResponse: Response;
      try {
        createResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new AmazonCrawlerServiceError(
          "Không kết nối được coordinator. Hãy chạy npm run dev.",
          "COORDINATOR_OFFLINE",
        );
      }

      const created = readJobCreated(await readJson(createResponse));
      jobId = created.jobId;
      onJobCreated?.(jobId);

      for (;;) {
        if (signal?.aborted) {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/summary`,
          { signal },
        );
        if (response.status === 404) {
          throw new DOMException("The crawler job was stopped and removed.", "AbortError");
        }
        const snapshot = readSnapshot(await readJson(response));
        onProgress?.(snapshot.progress);
        if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
          const resultResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/results`, { signal });
          return await readJson(resultResponse) as AmazonCrawlerOutput;
        }
        if (snapshot.status === "cancelled") {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        if (onProducts && Date.now() - lastProductsRefreshAt >= 5_000) {
          lastProductsRefreshAt = Date.now();
          if (await loadPagedJobProducts({ baseUrl, jobId, fetchImplementation, knownProducts, knownStatuses, signal })) {
            onProducts([...knownProducts.values()]);
          }
        }

        await wait(pollIntervalMs, signal);
      }
    } catch (caught: unknown) {
      if (signal?.aborted && jobId !== null) {
        try {
          await cancelJob();
        } catch {
          throw new AmazonCrawlerServiceError(
            "Không thể xác nhận coordinator đã dừng các crawler agent. Vui lòng thử Stop lại hoặc kiểm tra kết nối server.",
            "CANCEL_CONFIRMATION_FAILED",
          );
        }
      }
      throw caught;
    } finally {
      signal?.removeEventListener("abort", handleAbort);
    }
  };
}

export function createAmazonCrawlerJobController({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerJobController {
  const baseUrl = normalizeEngineUrl(engineUrl);
  const jobUrl = (jobId: string): string => `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`;
  return {
    async metrics(jobId) {
      const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/crawler-metrics${query}`, { signal: AbortSignal.timeout(10_000) }));
      try { return readCrawlerMetrics(payload); }
      catch (cause: unknown) { throw new AmazonCrawlerServiceError("Coordinator returned invalid crawler metrics.", "INVALID_ENGINE_RESPONSE", undefined, { cause }); }
    },
    async trace(jobId, requestId, cursor) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const payload = await readJson(await fetchImplementation(`${jobUrl(jobId)}/traces/${encodeURIComponent(requestId)}${query}`, { signal: AbortSignal.timeout(10_000) }));
      try { return readCrawlerTrace(payload); }
      catch (cause: unknown) { throw new AmazonCrawlerServiceError("Coordinator returned an invalid crawler trace.", "INVALID_ENGINE_RESPONSE", undefined, { cause }); }
    },
    async list(limit = 50) {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=${Math.max(1, Math.min(500, limit))}`));
      if (!Array.isArray(payload)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid job list.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.map(readJobSnapshot);
    },
    async get(jobId) {
      const snapshot = readJobSnapshot(await readJson(await fetchImplementation(jobUrl(jobId))));
      if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
        const result = await readJson(await fetchImplementation(`${jobUrl(jobId)}/results`));
        return { ...snapshot, result: result as AmazonCrawlerOutput };
      }
      return snapshot;
    },
    async pause(jobId) {
      const response = await fetchImplementation(`${jobUrl(jobId)}/pause`, { method: "POST" });
      return readJobSnapshot(await readJson(response));
    },
    async resume(jobId) {
      const response = await fetchImplementation(`${jobUrl(jobId)}/resume`, { method: "POST" });
      return readJobSnapshot(await readJson(response));
    },
    async cancel(jobId, options) {
      const query = options?.force ? "?force=true" : "";
      const response = await fetchImplementation(`${jobUrl(jobId)}/cancel${query}`, { method: "POST" });
      return readJobSnapshot(await readJson(response));
    },
    async cancelTask(taskId) {
      await readJson(await fetchImplementation(
        `${baseUrl}/api/v1/crawl-tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: "POST" },
      ));
    },
    async listDeadLetterTasks(options = {}) {
      const query = new URLSearchParams();
      if (options.jobId) query.set("job_id", options.jobId);
      if (options.errorCode) query.set("error_code", options.errorCode);
      query.set("limit", String(Math.max(1, Math.min(100, options.limit ?? 100))));
      query.set("offset", String(Math.max(0, options.offset ?? 0)));
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/dead-letter?${query}`));
      if (!isRecord(payload) || !Array.isArray(payload.items)
          || typeof payload.total !== "number" || typeof payload.limit !== "number" || typeof payload.offset !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid dead-letter page.", "INVALID_ENGINE_RESPONSE");
      }
      const items = payload.items.filter((value): value is Record<string, unknown> => isRecord(value));
      return { items: items.map((item) => ({
        taskId: String(item.taskId ?? ""), jobId: String(item.jobId ?? ""), asin: String(item.asin ?? ""),
        status: "dead_letter" as const, failureCount: Number(item.failureCount ?? 0), maxRetry: Number(item.maxRetry ?? 0),
        requeueCount: Number(item.requeueCount ?? 0), attemptCount: Number(item.attemptCount ?? 0),
        errorCode: String(item.errorCode ?? "UNKNOWN"), errorMessage: String(item.errorMessage ?? ""),
        nextRetryAt: typeof item.nextRetryAt === "string" ? item.nextRetryAt : null,
        createdAt: String(item.createdAt ?? ""), failedAt: typeof item.failedAt === "string" ? item.failedAt : null,
      })), total: payload.total, limit: payload.limit, offset: payload.offset };
    },
    async listTaskAttempts(taskId) {
      const payload = await readJson(await fetchImplementation(
        `${baseUrl}/api/v1/crawl-tasks/${encodeURIComponent(taskId)}/attempts`,
      ));
      if (!Array.isArray(payload)) throw new AmazonCrawlerServiceError("Coordinator returned invalid task attempts.", "INVALID_ENGINE_RESPONSE");
      return payload.filter((value): value is Record<string, unknown> => isRecord(value)).map((item) => ({
        attemptId: String(item.attemptId ?? ""), taskId: String(item.taskId ?? taskId),
        jobId: typeof item.jobId === "string" ? item.jobId : null, clientId: String(item.clientId ?? ""),
        status: String(item.status ?? "unknown"), errorCode: typeof item.errorCode === "string" ? item.errorCode : null,
        errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
        agentVersion: String(item.agentVersion ?? "unknown"), crawlerVersion: String(item.crawlerVersion ?? "unknown"),
        parserVersion: String(item.parserVersion ?? "unknown"), leasedAt: String(item.leasedAt ?? ""),
        startedAt: String(item.startedAt ?? ""), finishedAt: typeof item.finishedAt === "string" ? item.finishedAt : null,
        durationMs: typeof item.durationMs === "number" ? item.durationMs : null, archived: item.archived === true,
      }));
    },
    async applyDeadLetterAction(input: AmazonCrawlerDeadLetterActionInput): Promise<AmazonCrawlerDeadLetterActionResult> {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/dead-letter/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      }));
      if (!isRecord(payload) || (payload.action !== "requeue" && payload.action !== "delete")
          || typeof payload.changed !== "number" || !Array.isArray(payload.taskIds)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid dead-letter action result.", "INVALID_ENGINE_RESPONSE");
      }
      return { action: payload.action, changed: payload.changed,
        taskIds: payload.taskIds.filter((value): value is string => typeof value === "string"),
        jobId: typeof payload.jobId === "string" ? payload.jobId : null,
        errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null };
    },
    async invalidateProductCache(asin, amazonZip) {
      const path = `${baseUrl}/api/v1/clients/cache/products/${encodeURIComponent(asin)}`;
      const response = await fetchImplementation(`${path}?amazonZip=${encodeURIComponent(amazonZip)}`, { method: "DELETE" });
      return readCacheClearResult(await readJson(response));
    },
    async clearTemporaryData() {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients/temporary-data`, { method: "DELETE" });
      return readCacheClearResult(await readJson(response));
    },
    async replace(jobId, input) {
      const response = await fetchImplementation(`${jobUrl(jobId)}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          externalRequestId: `replace-${jobId}-${globalThis.crypto.randomUUID()}`,
        }),
      });
      const payload = await readJson(response);
      if (!isRecord(payload) || !isRecord(payload.replacementJob)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid replacement job.", "INVALID_ENGINE_RESPONSE");
      }
      return readJobSnapshot(payload.replacementJob);
    },
    async archive(jobId) {
      await readJson(await fetchImplementation(`${jobUrl(jobId)}/archive`, { method: "POST" }));
    },
    async delete(jobId) {
      await readJson(await fetchImplementation(jobUrl(jobId), { method: "DELETE" }));
    },
    async recoverClearedFamily(input) {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/asin-families/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }));
      if (!isRecord(payload) || typeof payload.recovered !== "number" || typeof payload.releasedAsins !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid family recovery result.", "INVALID_ENGINE_RESPONSE");
      }
      return { recovered: payload.recovered, releasedAsins: payload.releasedAsins };
    },
  };
}

export function createAmazonCrawlerSyncRetrier({
  engineUrl,
  fetchImplementation = fetch,
  pollIntervalMs = 700,
}: AmazonCrawlerClientOptions): AmazonCrawlerSyncRetrier {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async (jobId, options = {}) => {
    const knownProducts = new Map<string, AmazonCrawlerProduct>();
    const knownStatuses = new Map<string, string>();
    let lastProductsRefreshAt = 0;
    const response = await fetchImplementation(
      `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/retry-failed-syncs`,
      { method: "POST", signal: options.signal },
    );
    const payload = await readJson(response);
    if (!isRecord(payload) || typeof payload.retried !== "number") {
      throw new AmazonCrawlerServiceError("Coordinator returned an invalid retry response.", "INVALID_ENGINE_RESPONSE");
    }
    if (payload.retried === 0) return { retried: 0 };

    for (;;) {
      const snapshotResponse = await fetchImplementation(
        `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/summary`,
        { signal: options.signal },
      );
      const snapshot = readSnapshot(await readJson(snapshotResponse));
      options.onProgress?.(snapshot.progress);
      if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
        const resultResponse = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/results`,
          { signal: options.signal },
        );
        return {
          retried: payload.retried,
          output: await readJson(resultResponse) as AmazonCrawlerOutput,
        };
      }
      if (snapshot.status === "cancelled") {
        throw new DOMException("The crawler job was cancelled.", "AbortError");
      }
      if (options.onProducts && Date.now() - lastProductsRefreshAt >= 5_000) {
        lastProductsRefreshAt = Date.now();
        if (await loadPagedJobProducts({
          baseUrl, jobId, fetchImplementation, knownProducts, knownStatuses, signal: options.signal,
        })) {
          options.onProducts([...knownProducts.values()]);
        }
      }
      await wait(pollIntervalMs, options.signal);
    }
  };
}

export function serializeAmazonCrawlerInput(input: AmazonCrawlerInput): string {
  return JSON.stringify(input);
}

export function createAmazonCrawlerCacheClearer({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerCacheClearer {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async () => {
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}/api/v1/clients/cache`, { method: "DELETE" });
    } catch {
      throw new AmazonCrawlerServiceError(
        "Không kết nối được coordinator. Hãy chạy npm run dev.",
        "COORDINATOR_OFFLINE",
      );
    }
    return readCacheClearResult(await readJson(response));
  };
}

export function createAmazonCrawlerClientsLoader({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerClientsLoader {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async () => {
    try {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients`);
      return readClients(await readJson(response));
    } catch (error: unknown) {
      if (error instanceof AmazonCrawlerServiceError) throw error;
      throw new AmazonCrawlerServiceError("Không kết nối được coordinator. Hãy chạy npm run dev.", "COORDINATOR_OFFLINE");
    }
  };
}

export function createAmazonCrawlerAgentReleaseLoader({
  releaseApiUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerAgentReleaseOptions): AmazonCrawlerAgentReleaseLoader {
  return async () => {
    let response: Response;
    try {
      response = await fetchImplementation(releaseApiUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });
    } catch (error: unknown) {
      throw new AmazonCrawlerServiceError(
        "Không kết nối được kênh phát hành Crawler Agent.",
        "AGENT_RELEASE_OFFLINE",
        null,
        { cause: error },
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AmazonCrawlerServiceError(
        "Không tải được thông tin phiên bản Crawler Agent mới nhất.",
        "AGENT_RELEASE_REQUEST_FAILED",
        response.status,
      );
    }
    return readAgentRelease(body);
  };
}

function readImageProfile(value: unknown, baseUrl?: string): ImageProcessingProfile {
  if (!isRecord(value) || typeof value.slug !== "string" || typeof value.name !== "string") {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid image profile.", "INVALID_ENGINE_RESPONSE");
  }
  const profile = value as unknown as ImageProcessingProfile;
  if (!profile.hasLogo || !baseUrl) return profile;
  return {
    ...profile,
    logoUrl: `${baseUrl}/api/v1/image-profiles/${encodeURIComponent(profile.slug)}/logo?revision=${encodeURIComponent(profile.revision)}`,
  };
}

export function createImageProcessingProfileManager({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): ImageProcessingProfileManager {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return {
    async list() {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/image-profiles`));
      if (!isRecord(payload) || !Array.isArray(payload.profiles)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid image profile list.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.profiles.map((profile) => readImageProfile(profile, baseUrl));
    },
    async save(slug, profile) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      return readImageProfile(await readJson(response), baseUrl);
    },
    async delete(slug) {
      await readJson(await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }));
    },
    async uploadLogo(slug, dataUrl) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      return readImageProfile(await readJson(response), baseUrl);
    },
    async preview(slug, profile, dataUrl) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, dataUrl }),
      });
      const payload = await readJson(response);
      if (!isRecord(payload) || typeof payload.dataUrl !== "string") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid image preview.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.dataUrl;
    },
  };
}

function readReviewItem(value: unknown): AmazonCrawlerReviewItem {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.jobId !== "string" ||
    typeof value.sourceKey !== "string" ||
    typeof value.storeId !== "string" ||
    !["pending", "approved", "rejected"].includes(String(value.decision)) ||
    !["idle", "queued", "syncing", "synced", "failed"].includes(String(value.syncStatus)) ||
    (value.syncGeneration !== undefined && (!Number.isSafeInteger(value.syncGeneration) || Number(value.syncGeneration) < 0)) ||
    typeof value.version !== "number" ||
    !isRecord(value.target) ||
    !isRecord(value.product)
  ) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid review item.", "INVALID_ENGINE_RESPONSE");
  }
  return value as unknown as AmazonCrawlerReviewItem;
}

function readReviewItems(value: unknown): readonly AmazonCrawlerReviewItem[] {
  const items = isRecord(value) ? value.items : value;
  if (!Array.isArray(items)) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid review list.", "INVALID_ENGINE_RESPONSE");
  }
  return items.map(readReviewItem);
}

export function createAmazonCrawlerReviewClient({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerReviewClient {
  const baseUrl = normalizeEngineUrl(engineUrl);
  const reviewUrl = `${baseUrl}/api/v1/product-reviews`;

  const sendJson = async (url: string, method: string, body?: object): Promise<unknown> => {
    return readJson(await fetchImplementation(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }));
  };

  return {
    async catalog(query) {
      const parameters = new URLSearchParams({ storeId: query.storeId, offset: String(query.offset ?? 0), limit: String(query.limit ?? 50) });
      if (query.search) parameters.set("search", query.search);
      if (query.decision) parameters.set("decision", query.decision);
      if (query.workspace) parameters.set("workspace", query.workspace);
      if (query.stage) parameters.set("stage", query.stage);
      const value = await readJson(await fetchImplementation(`${reviewUrl}/catalog?${parameters}`, { signal: query.signal }));
      if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total !== "number") throw new AmazonCrawlerServiceError("Invalid review catalog.", "INVALID_ENGINE_RESPONSE");
      return readSeoReviewListPage(value, query.storeId);
    },
    async detail(itemId, storeId, signal) {
      return readReviewItem(await readJson(await fetchImplementation(`${reviewUrl}/${encodeURIComponent(itemId)}?storeId=${encodeURIComponent(storeId)}`, { signal })));
    },
    async archive(itemId, storeId) {
      const value = await readJson(await fetchImplementation(`${reviewUrl}/${encodeURIComponent(itemId)}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }),
      }));
      if (!isRecord(value) || value.archived !== true) throw new AmazonCrawlerServiceError("Review archive was not confirmed.", "INVALID_ENGINE_RESPONSE");
      return { archived: true };
    },
    subscribeCatalog(storeId, onChange) {
      let isStreaming = false;
      let didConnect = false;
      const timer = setInterval(() => { if (!isStreaming && document.visibilityState !== "hidden") onChange(); }, 10_000);
      const source = typeof EventSource === "undefined" ? null : new EventSource(`${reviewUrl}/catalog/events?storeId=${encodeURIComponent(storeId)}`);
      if (source) {
        source.onopen = () => { isStreaming = true; if (didConnect) onChange(); didConnect = true; };
        source.onerror = () => { isStreaming = false; };
        source.addEventListener("review_list_changed", onChange);
      }
      return () => { clearInterval(timer); source?.close(); };
    },
    async list() {
      return readReviewItems(await readJson(await fetchImplementation(reviewUrl)));
    },
    subscribe(onItems) {
      let isClosed = false;
      let isPolling = false;
      const poll = async (): Promise<void> => {
        if (isClosed || isPolling) return;
        isPolling = true;
        try {
          const items = readReviewItems(await readJson(await fetchImplementation(reviewUrl)));
          if (!isClosed) onItems(items);
        } catch {
          // Keep the last snapshot while the next poll or SSE reconnects.
        } finally {
          isPolling = false;
        }
      };
      void poll();
      const pollTimer = setInterval(() => void poll(), 2_000);
      if (typeof EventSource === "undefined") {
        return () => {
          isClosed = true;
          clearInterval(pollTimer);
        };
      }
      const source = new EventSource(`${reviewUrl}/events`);
      source.addEventListener("review_snapshot", (event) => {
        try {
          const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (!isClosed) onItems(readReviewItems(parsed));
        } catch {
          // Ignore malformed events; the initial request remains authoritative.
        }
      });
      source.onerror = () => {
        void poll();
      };
      return () => {
        isClosed = true;
        source.close();
        clearInterval(pollTimer);
      };
    },
    async update(itemId: string, expectedVersion: number, patch: AmazonCrawlerReviewEditPatch) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}`, "PATCH", {
        expectedVersion,
        patch,
      }));
    },
    async decide(
      itemId: string,
      expectedVersion: number,
      decision: AmazonCrawlerReviewDecision,
      reason?: string,
    ) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/decision`, "POST", {
        expectedVersion,
        decision,
        reason,
      }));
    },
    async sync(itemId: string) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/sync`, "POST"));
    },
    async reconcile(itemId: string) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/sync`, "POST", {
        reconcile: true,
      }));
    },
    async syncAllApproved() {
      const value = await sendJson(`${reviewUrl}/sync-approved`, "POST");
      if (!isRecord(value) || typeof value.queued !== "number" || !Array.isArray(value.itemIds)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid batch sync response.", "INVALID_ENGINE_RESPONSE");
      }
      return { queued: value.queued, itemIds: value.itemIds.map(String) };
    },
    async markSynced(itemId: string, info?: { productId?: string; productHandle?: string; adminUrl?: string }) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/synced`, "POST", info ?? {}));
    },
    async markFailed(itemId: string, error?: string) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/failed`, "POST", { error }));
    },
    async delete(itemId: string) {
      const value = await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}`, "DELETE");
      if (!isRecord(value) || value.deleted !== true) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid review delete response.", "INVALID_ENGINE_RESPONSE");
      }
      return { deleted: true };
    },
    async deleteAll() {
      const value = await sendJson(reviewUrl, "DELETE");
      if (!isRecord(value) || typeof value.deleted !== "number" || typeof value.skipped !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid review delete response.", "INVALID_ENGINE_RESPONSE");
      }
      return { deleted: value.deleted, skipped: value.skipped };
    },
    imageUrl(fileToken: string) {
      return `${reviewUrl}/images/${encodeURIComponent(fileToken)}`;
    },
  };
}

export function createAmazonCrawlerJobLoader({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerJobLoader {
  const baseUrl = normalizeEngineUrl(engineUrl);
  const productCache = new Map<string, Map<string, AmazonCrawlerProduct>>();
  const productStatusCache = new Map<string, Map<string, string>>();
  const settingsCache = new Map<string, AmazonCrawlerSettings>();
  return {
    async loadJob(jobId?: string): Promise<AmazonCrawlerHydratedJob | null> {
      try {
        let targetJobId = jobId;
        let jobSnapshot: CoordinatorSnapshot | null = null;
        let jobSettings: AmazonCrawlerSettings | undefined = undefined;

        if (!targetJobId) {
          const recentResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=5`);
          const recentJobs = await readJson(recentResponse);
          if (Array.isArray(recentJobs) && recentJobs.length > 0) {
            const candidate = recentJobs.find((j: unknown) => isRecord(j) && typeof j.id === "string") as Record<string, unknown> | undefined;
            if (candidate) {
              targetJobId = candidate.id as string;
              if (candidate.settings && isRecord(candidate.settings)) {
                jobSettings = candidate.settings as unknown as AmazonCrawlerSettings;
              }
            }
          }
        }

        if (!targetJobId) return null;

        const snapshotResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}/summary`);
        if (!snapshotResponse.ok) return null;
        const snapshotRaw = await readJson(snapshotResponse);
        if (!isRecord(snapshotRaw)) return null;
        jobSnapshot = readSnapshot(snapshotRaw);
        if (snapshotRaw.settings && isRecord(snapshotRaw.settings)) {
          jobSettings = snapshotRaw.settings as unknown as AmazonCrawlerSettings;
        }
        if (["completed", "partial", "review_pending", "cancelled"].includes(jobSnapshot.status)) {
          productCache.delete(targetJobId);
          productStatusCache.delete(targetJobId);
        }
        if (settingsCache.has(targetJobId)) {
          jobSettings = settingsCache.get(targetJobId);
        } else {
          productCache.clear();
          productStatusCache.clear();
          settingsCache.clear();
          const metadata = await readJson(await fetchImplementation(
            `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}/metadata`,
          ));
          if (!isRecord(metadata) || !isRecord(metadata.settings)) {
            throw new AmazonCrawlerServiceError("Coordinator returned invalid job metadata.", "INVALID_ENGINE_RESPONSE");
          }
          jobSettings = metadata.settings as unknown as AmazonCrawlerSettings;
          settingsCache.set(targetJobId, jobSettings);
        }

        let output: AmazonCrawlerOutput | null = null;
        if (jobSnapshot.status === "review_pending" || jobSnapshot.status === "completed" || jobSnapshot.status === "partial") {
          try {
            const resultsResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}/results`);
            if (resultsResponse.ok) {
              output = await readJson(resultsResponse) as AmazonCrawlerOutput;
            }
          } catch {
            // ignore results failure
          }
        }

        let products = output && Array.isArray(output.products) ? output.products : [];
        if (!output) {
          let knownProducts = productCache.get(targetJobId);
          if (!knownProducts) {
            knownProducts = new Map<string, AmazonCrawlerProduct>();
            productCache.set(targetJobId, knownProducts);
          }
          let knownStatuses = productStatusCache.get(targetJobId);
          if (!knownStatuses) {
            knownStatuses = new Map<string, string>();
            productStatusCache.set(targetJobId, knownStatuses);
          }
          try {
            await loadPagedJobProducts({ baseUrl, jobId: targetJobId, fetchImplementation, knownProducts, knownStatuses });
          } catch {
            // Keep products already loaded if the coordinator is temporarily unavailable.
          }
          products = [...knownProducts.values()];
        }

        if (!output && products.length > 0) {
          const stats: AmazonCrawlerStatistics = {
            requestedInputs: products.length,
            acceptedInputs: products.length,
            rejectedInputs: 0,
            products: products.length,
            sourceVariants: products.reduce((count, product) => count + (product.sourceVariants?.length || 0), 0),
            finalVariants: products.reduce((count, product) => count + (product.variants?.length || 0), 0),
            durationMs: 0,
          };
          output = {
            version: "1.0",
            jobId: targetJobId,
            status: (jobSnapshot.status === "review_pending" || jobSnapshot.status === "completed" || jobSnapshot.status === "partial" || jobSnapshot.status === "cancelled")
              ? jobSnapshot.status
              : "completed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            settings: jobSettings ?? DEFAULT_AMAZON_CRAWLER_SETTINGS,
            statistics: stats,
            products,
            errors: [],
            warnings: [],
            exportFilename: null,
          };
        }

        return {
          jobId: targetJobId,
          status: jobSnapshot.status,
          progress: jobSnapshot.progress,
          products,
          output,
          settings: jobSettings,
        };
      } catch (error: unknown) {
        if (error instanceof AmazonCrawlerServiceError) throw error;
        return null;
      }
    },

    async listRecentJobs(limit: number = 10): Promise<AmazonCrawlerJobSummary[]> {
      try {
        const response = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=${limit}`);
        const payload = await readJson(response);
        if (!Array.isArray(payload)) return [];
        return payload.map((job: unknown) => {
          const jobRecord = isRecord(job) ? job : {};
          return {
            id: String(jobRecord.id || ""),
            status: (jobRecord.status as AmazonCrawlerJobSummary["status"]) || "queued",
            executionState: jobRecord.executionState === "pausing" || jobRecord.executionState === "paused"
              ? jobRecord.executionState
              : "active",
            createdAt: String(jobRecord.createdAt || ""),
            startedAt: jobRecord.startedAt ? String(jobRecord.startedAt) : null,
            completedAt: jobRecord.completedAt ? String(jobRecord.completedAt) : null,
            acceptedInputs: typeof jobRecord.acceptedInputs === "number" ? jobRecord.acceptedInputs : 0,
            productCounts: isRecord(jobRecord.productCounts) ? (jobRecord.productCounts as Record<string, number>) : undefined,
            progress: isRecord(jobRecord.progress) ? (jobRecord.progress as unknown as AmazonCrawlerProgress) : undefined,
            seoQueueHandoff: isRecord(jobRecord.seoQueueHandoff)
              ? readSeoQueueHandoff(jobRecord.seoQueueHandoff)
              : undefined,
          };
        });
      } catch {
        return [];
      }
    },
  };
}
