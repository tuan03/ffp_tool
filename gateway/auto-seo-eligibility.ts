import type { DatabaseSync } from "node:sqlite";

import type { CustomGptQueue } from "./custom-gpt-seo/queue";
import type { SeoQueue } from "./custom-gpt-seo/queue-contract";
import type { GptSeoJob } from "../src/modules/custom-gpt-seo";
import type { AutoSeoBackupRepository } from "./auto-seo-backup-repository";
import type { AutoSeoPostgresReviewRepository } from "./auto-seo-review-postgres";

const MAX_ELIGIBILITY_PRODUCTS = 5_000;
const SQLITE_QUERY_CHUNK_SIZE = 400;

export type AutoSeoEligibilityState =
  | "never_processed"
  | "changed"
  | "current"
  | "active"
  | "retry";

export interface AutoSeoEligibilityProductSummary {
  readonly productId: string;
  readonly updatedAt?: string;
}

export interface AutoSeoEligibilityRequest {
  readonly storeId: string;
  readonly products: readonly AutoSeoEligibilityProductSummary[];
}

export interface AutoSeoEligibilityItem {
  readonly productId: string;
  readonly state: AutoSeoEligibilityState;
  readonly reason:
    | "NO_HISTORY"
    | "LAST_DISPATCH_FAILED"
    | "SHOPIFY_UPDATED"
    | "UP_TO_DATE"
    | "HASH_VERIFICATION_REQUIRED"
    | "SOURCE_TIMESTAMP_UNKNOWN"
    | "BASELINE_TIMESTAMP_UNKNOWN"
    | "ACTIVE_DISPATCH"
    | "ACTIVE_QUEUE"
    | "ACTIVE_REVIEW";
  readonly lastSuccessfulShopifyUpdatedAt?: string;
}

export interface AutoSeoEligibilityResponse {
  readonly items: readonly AutoSeoEligibilityItem[];
  readonly counts: Readonly<Record<AutoSeoEligibilityState, number>>;
}

export class AutoSeoEligibilityValidationError extends Error {
  public readonly code = "AUTO_SEO_INVALID_INPUT";

  public constructor(message: string) {
    super(message);
    this.name = "AutoSeoEligibilityValidationError";
  }
}

interface BackupRow {
  readonly product_id: string;
  readonly shopify_updated_at: string | null;
  readonly seo_input_sha256: string | null;
  readonly downstream_status: "NOT_SENT" | "SENT" | "FAILED";
  readonly created_at: string;
}

interface ReviewRow {
  readonly product_id: string;
  readonly shopify_updated_at: string | null;
}

interface EligibilityBackup {
  readonly productId: string;
  readonly shopifyUpdatedAt: string | null;
  readonly seoInputSha256: string | null;
  readonly downstreamStatus: "NOT_SENT" | "SENT" | "FAILED";
  readonly createdAt: string;
}

interface EligibilityReview {
  readonly productId: string;
  readonly shopifyUpdatedAt: string | null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function normalizeProductId(productId: string): string {
  return productId.trim().replace(/^gid:\/\/shopify\/Product\//, "");
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSameRevision(
  sourceUpdatedAt: string | undefined,
  baselineUpdatedAt: string | null | undefined,
): boolean {
  const sourceTime = timestamp(sourceUpdatedAt);
  const baselineTime = timestamp(baselineUpdatedAt);
  return sourceTime !== null && baselineTime !== null && sourceTime === baselineTime;
}

function queueJobUpdatedAt(job: GptSeoJob | null): string | undefined {
  const original = asRecord(job?.original);
  return typeof original?.updatedAt === "string" ? original.updatedAt : undefined;
}

function isQueueJobActive(job: GptSeoJob | null): boolean {
  return Boolean(job && ["PENDING", "IN_PROGRESS", "NEEDS_CHANGES", "VALIDATING", "REVIEW_READY"].includes(job.status));
}

function queryRowsByProductIds<T>(
  db: DatabaseSync,
  sqlPrefix: string,
  storeId: string,
  productIds: readonly string[],
): T[] {
  const rows: T[] = [];
  for (let offset = 0; offset < productIds.length; offset += SQLITE_QUERY_CHUNK_SIZE) {
    const chunk = productIds.slice(offset, offset + SQLITE_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    rows.push(...db.prepare(`${sqlPrefix} (${placeholders})`).all(storeId, ...chunk) as unknown as T[]);
  }
  return rows;
}

export function validateAutoSeoEligibilityRequest(body: unknown): AutoSeoEligibilityRequest {
  const request = asRecord(body);
  const storeId = typeof request?.storeId === "string" ? request.storeId.trim() : "";
  if (!storeId) throw new AutoSeoEligibilityValidationError("storeId is required");
  if (!Array.isArray(request?.products) || request.products.length === 0) {
    throw new AutoSeoEligibilityValidationError("products must be a non-empty array");
  }
  if (request.products.length > MAX_ELIGIBILITY_PRODUCTS) {
    throw new AutoSeoEligibilityValidationError(`products cannot exceed ${MAX_ELIGIBILITY_PRODUCTS} items`);
  }

  const seenProductIds = new Set<string>();
  const products = request.products.map((value, index): AutoSeoEligibilityProductSummary => {
    const product = asRecord(value);
    const productId = typeof product?.productId === "string" ? product.productId.trim() : "";
    if (!productId) {
      throw new AutoSeoEligibilityValidationError(`products[${index}].productId is required`);
    }
    if (seenProductIds.has(productId)) {
      throw new AutoSeoEligibilityValidationError(`Duplicate product id found in request: ${productId}`);
    }
    seenProductIds.add(productId);
    return {
      productId,
      ...(typeof product?.updatedAt === "string" ? { updatedAt: product.updatedAt.trim() } : {}),
    };
  });

  return { storeId, products };
}

export function getAutoSeoEligibility(
  db: DatabaseSync,
  request: AutoSeoEligibilityRequest,
  queue: Pick<CustomGptQueue, "findLatestSourceJob">,
): AutoSeoEligibilityResponse {
  const productIds = request.products.map((product) => product.productId);
  const backups = queryRowsByProductIds<BackupRow>(
    db,
    `SELECT product_id, shopify_updated_at, seo_input_sha256, downstream_status, created_at
     FROM auto_seo_product_backups
     WHERE store_id = ? AND product_id IN`,
    request.storeId,
    productIds,
  ).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const reviews = queryRowsByProductIds<ReviewRow>(
    db,
    `SELECT product_id, shopify_updated_at
     FROM seo_review_items
     WHERE store_id = ? AND deleted_at IS NULL AND review_status = 'pending' AND product_id IN`,
    request.storeId,
    productIds,
  );

  return buildAutoSeoEligibility(
    request,
    queue,
    backups.map(backup => ({
      productId: backup.product_id,
      shopifyUpdatedAt: backup.shopify_updated_at,
      seoInputSha256: backup.seo_input_sha256,
      downstreamStatus: backup.downstream_status,
      createdAt: backup.created_at,
    })),
    reviews.map(review => ({
      productId: review.product_id,
      shopifyUpdatedAt: review.shopify_updated_at,
    })),
  );
}

async function preloadQueueJobs(request: AutoSeoEligibilityRequest, queue: SeoQueue): Promise<Pick<CustomGptQueue, "findLatestSourceJob">> {
  const productIds = request.products.map(product => normalizeProductId(product.productId));
  const jobs = queue.findLatestSourceJobs
    ? await queue.findLatestSourceJobs(request.storeId, "auto_seo", productIds)
    : new Map(await Promise.all(productIds.map(async productId => [productId, await queue.findLatestSourceJob(request.storeId, "auto_seo", productId)] as const)));
  return { findLatestSourceJob: (_storeId, _source, productId) => jobs.get(normalizeProductId(productId)) ?? null };
}

export async function getAutoSeoEligibilityFromLegacyDatabase(db: DatabaseSync, request: AutoSeoEligibilityRequest, queue: SeoQueue): Promise<AutoSeoEligibilityResponse> {
  return getAutoSeoEligibility(db, request, await preloadQueueJobs(request, queue));
}

export async function getAutoSeoEligibilityFromRepositories(
  backupRepository: Pick<AutoSeoBackupRepository, "findByStoreAndProductIds">,
  reviewRepository: Pick<AutoSeoPostgresReviewRepository, "findPendingByStoreAndProductIds">,
  request: AutoSeoEligibilityRequest,
  queue: SeoQueue,
): Promise<AutoSeoEligibilityResponse> {
  const productIds = request.products.map(product => product.productId);
  const [backups, reviews] = await Promise.all([
    backupRepository.findByStoreAndProductIds(request.storeId, productIds),
    reviewRepository.findPendingByStoreAndProductIds(request.storeId, productIds),
  ]);
  return buildAutoSeoEligibility(
    request,
    await preloadQueueJobs(request, queue),
    backups.map(backup => ({
      productId: backup.productId,
      shopifyUpdatedAt: backup.shopifyUpdatedAt,
      seoInputSha256: backup.seoInputSha256 || null,
      downstreamStatus: backup.downstreamStatus,
      createdAt: backup.createdAt,
    })),
    reviews,
  );
}

function buildAutoSeoEligibility(
  request: AutoSeoEligibilityRequest,
  queue: Pick<CustomGptQueue, "findLatestSourceJob">,
  backups: readonly EligibilityBackup[],
  reviews: readonly EligibilityReview[],
): AutoSeoEligibilityResponse {
  const backupsByProduct = new Map<string, EligibilityBackup[]>();
  for (const backup of [...backups].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    const rows = backupsByProduct.get(backup.productId) ?? [];
    rows.push(backup);
    backupsByProduct.set(backup.productId, rows);
  }
  const reviewByProduct = new Map(reviews.map(review => [review.productId, review]));

  const items = request.products.map((product): AutoSeoEligibilityItem => {
    const productBackups = backupsByProduct.get(product.productId) ?? [];
    const latest = productBackups[0];
    const latestSuccessful = productBackups.find((backup) => backup.downstreamStatus === "SENT");
    const queueJob = queue.findLatestSourceJob(
      request.storeId,
      "auto_seo",
      normalizeProductId(product.productId),
    );
    if (
      isQueueJobActive(queueJob) &&
      isSameRevision(product.updatedAt, queueJobUpdatedAt(queueJob))
    ) {
      return { productId: product.productId, state: "active", reason: "ACTIVE_QUEUE" };
    }
    const review = reviewByProduct.get(product.productId);
    if (review && isSameRevision(product.updatedAt, review.shopifyUpdatedAt)) {
      return { productId: product.productId, state: "active", reason: "ACTIVE_REVIEW" };
    }
    if (
      latest?.downstreamStatus === "NOT_SENT" &&
      isSameRevision(product.updatedAt, latest.shopifyUpdatedAt)
    ) {
      return { productId: product.productId, state: "active", reason: "ACTIVE_DISPATCH" };
    }
    if (!latestSuccessful) {
      if (latest?.downstreamStatus === "FAILED") {
        return { productId: product.productId, state: "retry", reason: "LAST_DISPATCH_FAILED" };
      }
      return { productId: product.productId, state: "never_processed", reason: "NO_HISTORY" };
    }
    const lastSuccessfulShopifyUpdatedAt = latestSuccessful.shopifyUpdatedAt ?? undefined;
    if (!latestSuccessful.seoInputSha256) {
      return {
        productId: product.productId,
        state: "changed",
        reason: "HASH_VERIFICATION_REQUIRED",
        ...(lastSuccessfulShopifyUpdatedAt ? { lastSuccessfulShopifyUpdatedAt } : {}),
      };
    }
    const sourceTime = timestamp(product.updatedAt);
    if (sourceTime === null) {
      return {
        productId: product.productId,
        state: "changed",
        reason: "SOURCE_TIMESTAMP_UNKNOWN",
        ...(lastSuccessfulShopifyUpdatedAt ? { lastSuccessfulShopifyUpdatedAt } : {}),
      };
    }
    const baselineTime = timestamp(latestSuccessful.shopifyUpdatedAt);
    if (baselineTime === null) {
      return { productId: product.productId, state: "changed", reason: "BASELINE_TIMESTAMP_UNKNOWN" };
    }
    if (sourceTime > baselineTime) {
      return {
        productId: product.productId,
        state: "changed",
        reason: "SHOPIFY_UPDATED",
        lastSuccessfulShopifyUpdatedAt: latestSuccessful.shopifyUpdatedAt ?? undefined,
      };
    }
    return {
      productId: product.productId,
      state: "current",
      reason: "UP_TO_DATE",
      lastSuccessfulShopifyUpdatedAt: latestSuccessful.shopifyUpdatedAt ?? undefined,
    };
  });

  const counts: Record<AutoSeoEligibilityState, number> = {
    never_processed: 0,
    changed: 0,
    current: 0,
    active: 0,
    retry: 0,
  };
  for (const item of items) counts[item.state]++;
  return { items, counts };
}
