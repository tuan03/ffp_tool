import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { buildAeoMetafieldValues } from "../../src/modules/shopify-sync";

import { canonicalizeJson } from "../canonical-json";
import type { SeoContentSnapshot } from "../seo-versioning/snapshot-types";

import type { WorkerDatabase, WorkerSql } from "./database";
import { SeoWorkerError } from "./protocol";

const field = z.object({ value: z.string() });
function reviewFingerprint(review: unknown): string {
  return createHash("sha256").update(canonicalizeJson(review)).digest("hex");
}
const jsonField = z.object({ value: z.string().refine(value => {
  try { const parsed: unknown = JSON.parse(value); return typeof parsed === "object" && parsed !== null; }
  catch { return false; }
}) });
const reviewSchema = z.object({ reviewDecision: z.literal("approved"), updatedAt: z.number().int(),
  productTitle: field, productDescription: field, seoTitle: field, seoDescription: field,
  images: z.array(z.object({ id: z.string().regex(/^gid:\/\/shopify\/MediaImage\/\d+$/), alt: field })).optional(),
  aeoQuickSummary: field.optional(), aeoFaq: z.object({ value: z.array(z.object({ question: z.string(), answer: z.string() })) }).optional(), aeoJsonLd: jsonField.optional() });

function buildApprovedAeoMetafields(review: z.infer<typeof reviewSchema>): PublishFields["metafields"] {
  const { aeoQuickSummary, aeoFaq, aeoJsonLd } = review;
  // Older reviews without any AEO remain publishable; partial AEO must never be silently dropped.
  if (!aeoQuickSummary && !aeoFaq && !aeoJsonLd) return undefined;
  if (!aeoQuickSummary || !aeoFaq || !aeoJsonLd) throw new SeoWorkerError("INVALID_AEO_FIELDS");
  try {
    return [
      { namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: aeoQuickSummary.value },
      { namespace: "custom", key: "aeo_faq", type: "json", value: JSON.stringify(aeoFaq.value) },
      ...buildAeoMetafieldValues({ quickSummary: aeoQuickSummary.value, faq: aeoFaq.value, jsonLd: aeoJsonLd.value }),
    ];
  } catch {
    throw new SeoWorkerError("INVALID_AEO_FIELDS");
  }
}
export interface PublishFields {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly seo: { readonly title: string; readonly description: string };
  readonly images?: readonly { readonly id: string; readonly altText: string }[];
  readonly metafields?: readonly { readonly namespace: string; readonly key: string; readonly type: string; readonly value: string }[];
}
export interface PublishOperation {
  readonly id: string;
  readonly jobId: string;
  readonly storeId: string;
  readonly productId: string;
  readonly fields: PublishFields;
  readonly sourceVersion: string;
  readonly state: string;
  readonly leaseId: string | null;
  readonly seoVersion: number | null;
  readonly errorCode: string | null;
  readonly operator?: string;
  readonly basedOnVersionId?: string | null;
  readonly basedOnSnapshotId?: string | null;
  readonly basedOnContentHash?: string | null;
  readonly basedOnVersionNumber?: number | null;
  readonly versionSource?: "AUTO_SEO" | "ROLLBACK" | "IMPORTED";
  readonly restoredFromVersionId?: string | null;
  readonly targetContentHash?: string | null;
}

interface SeoPublishVersioningBridge {
  resolveDraftBase(sql: WorkerSql, storeId: string, jobId: string, shopifyProductGid: string): Promise<{
    readonly versionId: string; readonly snapshotId: string; readonly contentHash: string; readonly versionNumber: number;
  } | null>;
  commit(sql: WorkerSql, operation: PublishOperation, snapshot: SeoContentSnapshot, confirmedAt: number): Promise<{
    readonly outcome: "COMMITTED" | "NO_CHANGE"; readonly versionId: string; readonly versionNumber: number;
  }>;
}
function operation(row: Record<string, unknown>): PublishOperation {
  return { id: String(row.id), jobId: String(row.job_id), storeId: String(row.store_id), productId: String(row.product_id),
    fields: row.fields as PublishFields, sourceVersion: String(row.source_version), state: String(row.state),
    leaseId: row.lease_id === null ? null : String(row.lease_id), seoVersion: row.seo_version === null ? null : Number(row.seo_version),
    errorCode: row.error_code === null ? null : String(row.error_code), operator: String(row.operator),
    basedOnVersionId: row.based_on_version_id == null ? null : String(row.based_on_version_id),
    basedOnSnapshotId: row.based_on_snapshot_id == null ? null : String(row.based_on_snapshot_id),
    basedOnContentHash: row.based_on_content_hash == null ? null : String(row.based_on_content_hash),
    basedOnVersionNumber: row.based_on_version_number == null ? null : Number(row.based_on_version_number),
    versionSource: String(row.version_source ?? "AUTO_SEO") as PublishOperation["versionSource"],
    restoredFromVersionId: row.restored_from_version_id == null ? null : String(row.restored_from_version_id),
    targetContentHash: row.target_content_hash == null ? null : String(row.target_content_hash) };
}

/** Durable outbox; network calls must happen outside these short transactions. */
export class SeoPublishRepository {
  constructor(private readonly database: WorkerDatabase, private readonly now: () => number = Date.now,
    private readonly versioning?: SeoPublishVersioningBridge) {}

  async status(storeId: string, jobId: string): Promise<{ managed: boolean; operation: PublishOperation | null }> {
    return this.database.transaction(async sql => {
      if (!(await sql.query("SELECT id FROM gpt_jobs WHERE id=$1 AND store_id=$2", [jobId, storeId])).rows.length) throw new SeoWorkerError("PUBLISH_NOT_FOUND");
      const managed = (await sql.query("SELECT store_id FROM seo_worker_stores WHERE store_id=$1", [storeId])).rows.length > 0;
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE job_id=$1 AND store_id=$2", [jobId, storeId])).rows[0];
      return { managed, operation: row ? operation(row) : null };
    });
  }

  async requestReconciliation(storeId: string, jobId: string, operatorName: string): Promise<PublishOperation> {
    return this.database.transaction(async sql => {
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE store_id=$1 AND job_id=$2 FOR UPDATE", [storeId, jobId])).rows[0];
      if (!row) throw new SeoWorkerError("PUBLISH_NOT_FOUND");
      if (row.state !== "BLOCKED") return operation(row);
      if (row.has_write_intent === false && row.error_code === "PUBLISH_INPUT_REJECTED") {
        const next = (await sql.query("UPDATE seo_publish_operations SET state='QUEUED',attempts=0,retry_at=0,error_code=NULL,updated_at=$2 WHERE id=$1 RETURNING *", [row.id, this.now()])).rows[0];
        await sql.query("INSERT INTO gpt_audit(store_id,job_id,event,created_at) VALUES ($1,$2,$3,$4)", [storeId, jobId, `PUBLISH_REJECTED_RETRY_REQUESTED:${operatorName}`, this.now()]);
        return operation(next);
      }
      if (row.has_write_intent !== true) throw new SeoWorkerError("SOURCE_REASSESSMENT_REQUIRED");
      const next = (await sql.query("UPDATE seo_publish_operations SET state='UNCERTAIN',attempts=0,retry_at=0,error_code=NULL,updated_at=$2 WHERE id=$1 RETURNING *", [row.id, this.now()])).rows[0];
      await sql.query("INSERT INTO gpt_audit(store_id,job_id,event,created_at) VALUES ($1,$2,$3,$4)", [storeId, jobId, `PUBLISH_READBACK_REQUESTED:${operatorName}`, this.now()]);
      return operation(next);
    });
  }

  async enqueue(input: { storeId: string; jobId: string; reviewUpdatedAt: number; requestId: string; operator: string;
    versionSource?: "AUTO_SEO" | "ROLLBACK"; restoredFromVersionId?: string | null }): Promise<PublishOperation> {
    z.object({ storeId: z.string().min(1).max(100), jobId: z.string().min(1).max(200), reviewUpdatedAt: z.number().int(), requestId: z.string().min(1).max(200),
      operator: z.string().min(1).max(200), versionSource: z.enum(["AUTO_SEO", "ROLLBACK"]).optional(), restoredFromVersionId: z.string().min(1).nullable().optional() }).strict().parse(input);
    const versionSource = input.versionSource ?? "AUTO_SEO";
    if ((versionSource === "ROLLBACK") !== Boolean(input.restoredFromVersionId)) throw new SeoWorkerError("ROLLBACK_SOURCE_REQUIRED");
    return this.database.transaction(async sql => {
      const replay = (await sql.query("SELECT * FROM seo_publish_operations WHERE store_id=$1 AND (request_id=$2 OR job_id=$3) FOR UPDATE", [input.storeId, input.requestId, input.jobId])).rows[0];
      if (replay) {
        if (replay.job_id !== input.jobId || Number(replay.review_revision) !== input.reviewUpdatedAt) throw new SeoWorkerError("IDEMPOTENCY_CONFLICT");
        return operation(replay);
      }
      if ((await sql.query("SELECT job_id FROM seo_worker_revisions WHERE previous_job_id=$1", [input.jobId])).rows.length) throw new SeoWorkerError("REVIEW_SUPERSEDED");
      if (!(await sql.query("SELECT store_id FROM seo_worker_stores WHERE store_id=$1", [input.storeId])).rows.length) throw new SeoWorkerError("WORKER_STORE_DISABLED");
      const row = (await sql.query(`SELECT j.payload,r.payload AS review FROM gpt_jobs j JOIN gpt_review_state r ON r.job_id=j.id
        WHERE j.id=$1 AND j.store_id=$2 AND j.status='REVIEW_READY' FOR UPDATE OF j,r`, [input.jobId, input.storeId])).rows[0];
      if (!row) throw new SeoWorkerError("APPROVED_REVIEW_REQUIRED");
      const newer = (await sql.query(`SELECT 1 FROM gpt_jobs newer JOIN gpt_jobs current ON current.id=$1
        WHERE newer.store_id=current.store_id AND newer.queue_order>current.queue_order
        AND newer.payload::jsonb->>'source'=current.payload::jsonb->>'source'
        AND newer.payload::jsonb->>'sourceIdentity'=current.payload::jsonb->>'sourceIdentity' LIMIT 1`, [input.jobId])).rows[0];
      if (newer) throw new SeoWorkerError("STALE_SOURCE");
      const review = reviewSchema.safeParse(JSON.parse(String(row.review)));
      if (!review.success) {
        if (review.error.issues.every(issue => issue.path[0] === "images")) throw new SeoWorkerError("REVIEW_IMAGE_MAPPING_REQUIRED");
        throw new SeoWorkerError("APPROVED_REVIEW_REQUIRED");
      }
      if (review.data.updatedAt !== input.reviewUpdatedAt) throw new SeoWorkerError("VERSION_CONFLICT");
      const job = z.object({ execution: z.object({ productId: z.string().regex(/^(gid:\/\/shopify\/Product\/)?\d+$/),
        originalSnapshot: z.object({ updatedAt: z.string().min(1), seoVersion: z.number().int().nonnegative().optional() }) }) }).safeParse(JSON.parse(String(row.payload)));
      if (!job.success) throw new SeoWorkerError("SOURCE_VERSION_REQUIRED");
      if ((await sql.query("SELECT job_id FROM gpt_sync WHERE job_id=$1", [input.jobId])).rows.length) throw new SeoWorkerError("SYNC_ALREADY_STARTED");
      const productId = job.data.execution.productId.replace(/^gid:\/\/shopify\/Product\//, "");
      const draftBase = this.versioning ? await this.versioning.resolveDraftBase(sql, input.storeId, input.jobId,
        `gid://shopify/Product/${productId}`) : null;
      const active = (await sql.query("SELECT id FROM seo_publish_operations WHERE store_id=$1 AND product_id=$2 AND state!='SUCCEEDED' AND superseded_by IS NULL", [input.storeId, productId])).rows[0];
      if (active) throw new SeoWorkerError("PRODUCT_PUBLISH_ACTIVE");
      const aeoMetafields = buildApprovedAeoMetafields(review.data);
      const fields: PublishFields = { title: review.data.productTitle.value, descriptionHtml: review.data.productDescription.value,
        seo: { title: review.data.seoTitle.value, description: review.data.seoDescription.value },
        ...(review.data.images ? { images: review.data.images.map(image => ({ id: image.id, altText: image.alt.value })) } : {}),
        ...(aeoMetafields ? { metafields: aeoMetafields } : {}) };
      const id = randomUUID();
      const created = (await sql.query(`INSERT INTO seo_publish_operations(id,job_id,store_id,product_id,request_id,review_revision,operator,fields,source_version,baseline_version,state,created_at,updated_at,review_fingerprint,
        based_on_version_id,based_on_snapshot_id,based_on_content_hash,based_on_version_number,version_source,restored_from_version_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'QUEUED',$11,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [id, input.jobId, input.storeId, productId, input.requestId, input.reviewUpdatedAt, input.operator, JSON.stringify(fields),
        job.data.execution.originalSnapshot.updatedAt, job.data.execution.originalSnapshot.seoVersion ?? 0, this.now(), reviewFingerprint(review.data),
        draftBase?.versionId ?? null, draftBase?.snapshotId ?? null, draftBase?.contentHash ?? null, draftBase?.versionNumber ?? null,
        versionSource, input.restoredFromVersionId ?? null])).rows[0];
      await sql.query("INSERT INTO gpt_sync(job_id,token,status) VALUES ($1,$2,'SYNCING')", [input.jobId, id]);
      return operation(created);
    });
  }

  async get(storeId: string, id: string): Promise<PublishOperation> {
    return this.database.transaction(async sql => {
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE store_id=$1 AND id=$2", [storeId, id])).rows[0];
      if (!row) throw new SeoWorkerError("PUBLISH_NOT_FOUND");
      return operation(row);
    });
  }

  async claim(): Promise<PublishOperation | null> {
    return this.database.transaction(async sql => {
      // A writer that disappeared may still have committed remotely. Never send it again.
      await sql.query("UPDATE seo_publish_operations SET state='UNCERTAIN',lease_id=NULL,lease_until=NULL WHERE state='WRITING' AND lease_until<=$1", [this.now()]);
      await sql.query("UPDATE seo_publish_operations SET state='QUEUED',lease_id=NULL,lease_until=NULL WHERE state='CHECKING' AND lease_until<=$1", [this.now()]);
      const row = (await sql.query(`SELECT * FROM seo_publish_operations WHERE state IN ('QUEUED','UNCERTAIN')
        AND retry_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [this.now()])).rows[0];
      if (!row) return null;
      const next = (await sql.query(`UPDATE seo_publish_operations SET state=CASE WHEN state='QUEUED' THEN 'CHECKING' ELSE state END,
        lease_id=$2,lease_until=$3,attempts=attempts+1,updated_at=$4 WHERE id=$1 RETURNING *`, [row.id, randomUUID(), this.now() + 120_000, this.now()])).rows[0];
      return operation(next);
    });
  }

  async authorizeWrite(op: PublishOperation, remoteVersion?: number, authoritativeTargetVersion?: number,
    targetContentHash?: string): Promise<PublishOperation> {
    return this.database.transaction(async sql => {
      const approved = (await sql.query(`SELECT r.payload FROM gpt_review_state r JOIN gpt_jobs j ON j.id=r.job_id WHERE j.id=$1 AND j.status='REVIEW_READY' FOR UPDATE OF j,r`, [op.jobId])).rows[0];
      const review = approved ? reviewSchema.safeParse(JSON.parse(String(approved.payload))) : null;
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE id=$1 AND lease_id=$2 AND state='CHECKING' AND lease_until>$3 FOR UPDATE", [op.id, op.leaseId, this.now()])).rows[0];
      if (!row) throw new SeoWorkerError("STALE_PUBLISH_LEASE");
      if (!review?.success || review.data.updatedAt !== Number(row.review_revision) || reviewFingerprint(review.data) !== row.review_fingerprint) throw new SeoWorkerError("REVIEW_CHANGED");
      let fields = op.fields;
      let targetVersion: number | null = null;
      if (authoritativeTargetVersion !== undefined) {
        if (!Number.isSafeInteger(authoritativeTargetVersion) || authoritativeTargetVersion < 1) throw new SeoWorkerError("INVALID_SEO_VERSION");
        targetVersion = authoritativeTargetVersion;
        fields = { ...fields, metafields: [...(fields.metafields ?? []).filter(field => !(field.namespace === "custom" && field.key === "seo_version")),
          { namespace: "custom", key: "seo_version", type: "number_integer", value: String(targetVersion) }] };
      } else if (remoteVersion !== undefined) {
        if (!Number.isSafeInteger(remoteVersion) || remoteVersion < 0) throw new SeoWorkerError("INVALID_SEO_VERSION");
        const highest = Number((await sql.query("SELECT COALESCE(max(version),0) AS version FROM seo_publish_versions WHERE store_id=$1 AND product_id=$2", [op.storeId, op.productId])).rows[0].version);
        targetVersion = Math.max(remoteVersion, Number(row.baseline_version), highest) + 1;
        if (!Number.isSafeInteger(targetVersion)) throw new SeoWorkerError("INVALID_SEO_VERSION");
        fields = { ...fields, metafields: [...(fields.metafields ?? []).filter(field => !(field.namespace === "custom" && field.key === "seo_version")),
          { namespace: "custom", key: "seo_version", type: "number_integer", value: String(targetVersion) }] };
      }
      const updated = (await sql.query("UPDATE seo_publish_operations SET state='WRITING',has_write_intent=true,updated_at=$2,fields=$3::jsonb,target_version=$4,target_content_hash=$5 WHERE id=$1 RETURNING *",
        [op.id, this.now(), JSON.stringify(fields), targetVersion, targetContentHash ?? null])).rows[0];
      return operation(updated);
    });
  }

  async defer(op: PublishOperation, uncertain: boolean): Promise<void> {
    await this.database.transaction(async sql => {
      await sql.query(`UPDATE seo_publish_operations SET state=CASE WHEN attempts>=5 THEN 'BLOCKED' WHEN $3 THEN 'UNCERTAIN' ELSE 'QUEUED' END,
        lease_id=NULL,lease_until=NULL,retry_at=$4,error_code=CASE WHEN attempts>=5 THEN 'RECONCILIATION_REQUIRED' ELSE 'TRANSPORT_UNAVAILABLE' END,updated_at=$5
        WHERE id=$1 AND lease_id=$2 AND lease_until>$5`, [op.id, op.leaseId, uncertain, this.now() + 60_000, this.now()]);
    });
  }

  async rejectBeforeWrite(op: PublishOperation, code: "PUBLISH_INPUT_REJECTED"): Promise<void> {
    await this.database.transaction(async sql => {
      await sql.query("UPDATE seo_publish_operations SET state='BLOCKED',has_write_intent=false,error_code=$3,lease_id=NULL,lease_until=NULL,updated_at=$4 WHERE id=$1 AND lease_id=$2 AND state='WRITING' AND lease_until>$4", [op.id, op.leaseId, code, this.now()]);
    });
  }

  async block(op: PublishOperation, code: string): Promise<void> {
    await this.database.transaction(async sql => {
      await sql.query("UPDATE seo_publish_operations SET state='BLOCKED',error_code=$3,lease_id=NULL,lease_until=NULL,updated_at=$4 WHERE id=$1 AND lease_id=$2 AND lease_until>$4", [op.id, op.leaseId, code, this.now()]);
      // Keep product reservation and sync guard; a blocked/uncertain write must not regenerate SEO.
    });
  }

  async confirm(op: PublishOperation): Promise<void> {
    await this.confirmWithSnapshot(op);
  }

  async confirmWithSnapshot(op: PublishOperation, snapshot?: SeoContentSnapshot): Promise<void> {
    await this.database.transaction(async sql => {
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE id=$1 AND lease_id=$2 AND lease_until>$3 AND state IN ('WRITING','UNCERTAIN') FOR UPDATE", [op.id, op.leaseId, this.now()])).rows[0];
      if (!row) throw new SeoWorkerError("STALE_PUBLISH_LEASE");
      const confirmedAt = this.now();
      let seoVersionId: string | null = null;
      let version: number;
      if (row.based_on_version_id !== null) {
        if (!this.versioning || !snapshot) throw new SeoWorkerError("SEO_VERSION_SNAPSHOT_REQUIRED");
        const committed = await this.versioning.commit(sql, operation(row), snapshot, confirmedAt);
        if (committed.outcome !== "COMMITTED") throw new SeoWorkerError("SEO_VERSION_COMMIT_MISMATCH");
        version = committed.versionNumber;
        seoVersionId = committed.versionId;
      } else {
        const highest = Number((await sql.query("SELECT COALESCE(max(version),0) AS version FROM seo_publish_versions WHERE store_id=$1 AND product_id=$2", [op.storeId, op.productId])).rows[0].version);
        version = row.target_version === null ? Math.max(Number(row.baseline_version), highest) + 1 : Number(row.target_version);
      }
      if (row.target_version !== null && Number(row.target_version) !== version) throw new SeoWorkerError("SEO_VERSION_COMMIT_MISMATCH");
      await sql.query("INSERT INTO seo_publish_versions(operation_id,store_id,product_id,version,confirmed_at,seo_version_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [op.id, op.storeId, op.productId, version, confirmedAt, seoVersionId]);
      await sql.query("UPDATE seo_publish_operations SET state='SUCCEEDED',seo_version=$2,error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=$3 WHERE id=$1", [op.id, version, this.now()]);
      await sql.query("UPDATE gpt_sync SET status='SYNCED' WHERE job_id=$1 AND token=$2", [op.jobId, op.id]);
      await sql.query(`UPDATE gpt_review_state SET payload=(payload::jsonb || jsonb_build_object('shopifySyncStatus','synced','seoVersion',$2::bigint,'shopifySyncedAt',$3::bigint))::text WHERE job_id=$1`, [op.jobId, version, this.now()]);
      await sql.query("UPDATE seo_worker_jobs SET state='CLOSED',pipeline_active=false,updated_at=$2 WHERE job_id=$1 AND lease_id IS NULL", [op.jobId, this.now()]);
    });
  }

  async confirmNoChange(op: PublishOperation, snapshot: SeoContentSnapshot): Promise<void> {
    await this.database.transaction(async sql => {
      const approved = (await sql.query(`SELECT r.payload FROM gpt_review_state r JOIN gpt_jobs j ON j.id=r.job_id
        WHERE j.id=$1 AND j.status='REVIEW_READY' FOR UPDATE OF j,r`, [op.jobId])).rows[0];
      const review = approved ? reviewSchema.safeParse(JSON.parse(String(approved.payload))) : null;
      const row = (await sql.query("SELECT * FROM seo_publish_operations WHERE id=$1 AND lease_id=$2 AND state='CHECKING' AND lease_until>$3 FOR UPDATE",
        [op.id, op.leaseId, this.now()])).rows[0];
      if (!row) throw new SeoWorkerError("STALE_PUBLISH_LEASE");
      if (!review?.success || review.data.updatedAt !== Number(row.review_revision) || reviewFingerprint(review.data) !== row.review_fingerprint) {
        throw new SeoWorkerError("REVIEW_CHANGED");
      }
      if (!this.versioning || row.based_on_version_id === null) throw new SeoWorkerError("SEO_DRAFT_BASE_REQUIRED");
      const confirmedAt = this.now();
      const committed = await this.versioning.commit(sql, operation(row), snapshot, confirmedAt);
      if (committed.outcome !== "NO_CHANGE") throw new SeoWorkerError("SEO_VERSION_COMMIT_MISMATCH");
      await sql.query("UPDATE seo_publish_operations SET state='SUCCEEDED',seo_version=$2,error_code='NO_CHANGE',lease_id=NULL,lease_until=NULL,updated_at=$3 WHERE id=$1",
        [op.id, committed.versionNumber, confirmedAt]);
      await sql.query("UPDATE gpt_sync SET status='SYNCED' WHERE job_id=$1 AND token=$2", [op.jobId, op.id]);
      await sql.query(`UPDATE gpt_review_state SET payload=(payload::jsonb || jsonb_build_object('shopifySyncStatus','no_change','seoVersion',$2::bigint,'shopifySyncedAt',$3::bigint))::text WHERE job_id=$1`,
        [op.jobId, committed.versionNumber, confirmedAt]);
      await sql.query("UPDATE seo_worker_jobs SET state='CLOSED',pipeline_active=false,updated_at=$2 WHERE job_id=$1 AND lease_id IS NULL", [op.jobId, confirmedAt]);
    });
  }
}
