import type { DatabaseSync } from "node:sqlite";

import { upsertSeoReviewItem, type SeoReviewItemRecord } from "./seo-review-db";

export class SeoValidationError extends Error {
  public constructor(
    message: string,
    public readonly validationErrors: readonly string[] = [],
    public readonly code: "SEO_VALIDATION_ERROR" = "SEO_VALIDATION_ERROR",
  ) {
    super(message);
    this.name = "SeoValidationError";
  }
}

export interface ValidatedSeoFields {
  readonly title: string;
  readonly description: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly handle: string;
}

export function validateGeneratedSeoFields(
  output: unknown,
  fallbackHandle?: string,
): ValidatedSeoFields {
  if (!output || typeof output !== "object") {
    throw new SeoValidationError("Generated SEO output must be a non-null object", [
      "output is not an object",
    ]);
  }

  const record = output as Record<string, unknown>;
  const errors: string[] = [];

  const rawTitle = record.productTitle ?? record.title;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) {
    errors.push("Missing or empty generated product title (title / productTitle)");
  }

  const rawDescription = record.productDescription ?? record.description;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (!description) {
    errors.push("Missing or empty generated product description (description / productDescription)");
  }

  const rawSeoTitle = record.productSeoTitle ?? record.seoTitle;
  const seoTitle = typeof rawSeoTitle === "string" ? rawSeoTitle.trim() : "";
  if (!seoTitle) {
    errors.push("Missing or empty generated SEO title (seoTitle / productSeoTitle)");
  }

  const rawSeoDescription = record.productSeoDescription ?? record.seoDescription;
  const seoDescription = typeof rawSeoDescription === "string" ? rawSeoDescription.trim() : "";
  if (!seoDescription) {
    errors.push("Missing or empty generated SEO description (seoDescription / productSeoDescription)");
  }

  const rawHandle = record.productHandle ?? record.handle ?? fallbackHandle;
  const handle = typeof rawHandle === "string" ? rawHandle.trim() : "";
  if (!handle) {
    errors.push("Missing or empty generated handle (handle / productHandle)");
  }

  if (errors.length > 0) {
    throw new SeoValidationError(
      `SEO validation failed with ${errors.length} error(s): ${errors.join("; ")}`,
      errors,
    );
  }

  return {
    title,
    description,
    seoTitle,
    seoDescription,
    handle,
  };
}

export interface SeoReviewLifecycleInput {
  readonly storeId: string;
  readonly productId: string;
  readonly handle?: string;
  readonly title?: string;
  readonly shopifyUpdatedAt?: string | null;
  readonly generatedOutput?: unknown;
  readonly generate?: () => Promise<unknown> | unknown;
  readonly queueItemId?: string;
}

export interface SeoReviewProgressEvent {
  readonly stage: "completed";
  readonly storeId: string;
  readonly productId: string;
  readonly itemId: string;
  readonly reviewStatus: "pending";
  readonly timestamp: string;
}

export interface SeoReviewLifecycleOptions {
  readonly db: DatabaseSync;
  readonly itemId?: string;
  readonly onPersistSeoOutput?: (output: unknown) => Promise<void> | void;
  readonly onMarkQueueCompleted?: (queueItemId: string) => Promise<void> | void;
  readonly onEmitProgressEvent?: (event: SeoReviewProgressEvent) => Promise<void> | void;
}

export interface SeoReviewLifecycleResult {
  readonly success: true;
  readonly itemId: string;
  readonly reviewItem: SeoReviewItemRecord;
  readonly validatedFields: ValidatedSeoFields;
  readonly stepLog: readonly string[];
}

/**
 * Strict Save Order Lifecycle:
 * Generate -> Validate -> Persist SEO Output -> Persist Review Item in SQLite -> Mark Completed in Queue -> Emit Progress Event
 */
export async function executeSeoReviewSaveLifecycle(
  input: SeoReviewLifecycleInput,
  options: SeoReviewLifecycleOptions,
): Promise<SeoReviewLifecycleResult> {
  const stepLog: string[] = [];

  // Step 1: Generate
  stepLog.push("generate");
  let output: unknown;
  if (typeof input.generate === "function") {
    output = await input.generate();
  } else {
    output = input.generatedOutput;
  }
  if (!output) {
    throw new SeoValidationError("No generated SEO output provided", ["output is missing"]);
  }

  // Step 2: Validate
  stepLog.push("validate");
  const validated = validateGeneratedSeoFields(output, input.handle);

  // Step 3: Persist SEO Output
  stepLog.push("persist_seo_output");
  if (options.onPersistSeoOutput) {
    await options.onPersistSeoOutput(output);
  }

  // Step 4: Persist Review Item in SQLite
  stepLog.push("persist_review_item_sqlite");
  const itemId = options.itemId ?? `${input.storeId}:${input.productId}`;
  const serializedPayload = typeof output === "string" ? output : JSON.stringify(output);
  const reviewItem: SeoReviewItemRecord = {
    itemId,
    storeId: input.storeId,
    productId: input.productId,
    handle: validated.handle,
    title: validated.title,
    reviewStatus: "pending",
    generatedPayload: serializedPayload,
    shopifyUpdatedAt: input.shopifyUpdatedAt ?? null,
  };
  upsertSeoReviewItem(options.db, reviewItem);

  // Step 5: Mark Completed in Queue
  stepLog.push("mark_completed_in_queue");
  if (options.onMarkQueueCompleted) {
    const queueKey = input.queueItemId ?? itemId;
    await options.onMarkQueueCompleted(queueKey);
  }

  // Step 6: Emit Progress Event
  stepLog.push("emit_progress_event");
  const progressEvent: SeoReviewProgressEvent = {
    stage: "completed",
    storeId: input.storeId,
    productId: input.productId,
    itemId,
    reviewStatus: "pending",
    timestamp: new Date().toISOString(),
  };
  if (options.onEmitProgressEvent) {
    await options.onEmitProgressEvent(progressEvent);
  }

  return {
    success: true,
    itemId,
    reviewItem,
    validatedFields: validated,
    stepLog,
  };
}
