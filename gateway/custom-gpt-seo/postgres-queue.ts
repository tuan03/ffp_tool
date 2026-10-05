import { createHash, randomUUID } from "node:crypto";
import { PostgresQueueDatabase } from "./postgres-database";
import type { SeoQueuePostgresOptions } from "./postgres-database";
import type { SeoQueue } from "./queue-contract";
import type { QueueListFilters } from "./queue";

import type { ExternalSeoProvider, GptCheckpointMutation, GptJobStatus, GptSeoBatch, GptSeoEnqueue, GptSeoJob, GptSeoSettings, SeoProvider } from "../../src/modules/custom-gpt-seo";
import { canonicalizeJson } from "../canonical-json";
import { getWorkerProductKey, SeoWorkerError } from "../seo-worker/protocol";
import type { WorkerDatabase } from "../seo-worker/database";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { SeoPublishRepository } from "../seo-worker/publish-repository";
import { SeoRevisionRepository } from "../seo-worker/revision-repository";
import { SeoCutoverRepository } from "../seo-worker/cutover";
import { SeoReviewHistoryRepository } from "../seo-worker/review-history";
import { SeoPublishVersioningIntegration, SeoVersionRepository } from "../seo-versioning";
import { normalizeSeoEnqueue, SEO_WORKER_SCHEMA_VERSION } from "./input-contract";

const LEASE_MS = 30 * 60_000;
const DEFAULT_SETTINGS: GptSeoSettings = { provider: "gemini", batchSize: 5, version: 1, language: "en-US", instructions: "Use only grounded product facts. Never invent certifications, materials or performance claims." };
function hash(value: unknown): string { return createHash("sha256").update(canonicalizeJson(value)).digest("hex"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored record");
  return value as Record<string, unknown>;
}
function json(value: unknown): unknown { return JSON.parse(String(value)); }

/** PostgreSQL transactions fence claims; the supplied clock makes lease tests deterministic. */
export class PostgresCustomGptQueue implements SeoQueue {
  private readonly db: PostgresQueueDatabase;
  readonly workers: SeoWorkerRepository;
  readonly publisher: SeoPublishRepository;
  readonly revisions: SeoRevisionRepository;
  readonly cutover: SeoCutoverRepository;
  readonly workerHistory: SeoReviewHistoryRepository;
  readonly versioning: SeoVersionRepository;
  readonly publishVersioning: SeoPublishVersioningIntegration;
  constructor(options: SeoQueuePostgresOptions, private readonly now: () => number = Date.now) {
    this.db = new PostgresQueueDatabase(options);
    const workerDatabase: WorkerDatabase = { transaction: operation => this.db.withClientTransaction(operation) };
    this.versioning = new SeoVersionRepository(workerDatabase, this.db.schema);
    this.publishVersioning = new SeoPublishVersioningIntegration(this.versioning);
    this.workers = new SeoWorkerRepository(workerDatabase, now);
    this.publisher = new SeoPublishRepository(workerDatabase, now, this.publishVersioning);
    this.revisions = new SeoRevisionRepository({ transaction: operation => this.db.withClientTransaction(operation) }, (input, previousJobId) => this.enqueueRevision(input, previousJobId), now);
    this.cutover = new SeoCutoverRepository({ transaction: operation => this.db.withClientTransaction(operation) }, storeId => this.workers.enableStore(storeId), now, storeId => this.expire(storeId, "codex_mcp"));
    this.workerHistory = new SeoReviewHistoryRepository({ transaction: operation => this.db.withClientTransaction(operation) });
  }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> { return this.db.transaction(operation); }
  async settings(storeId: string): Promise<GptSeoSettings> {
    const row = (await this.db.prepare("SELECT payload FROM gpt_settings WHERE store_id=?").get(storeId));
    return row ? json(row.payload) as GptSeoSettings : { ...DEFAULT_SETTINGS };
  }
  async configure(storeId: string, settings: Pick<GptSeoSettings, "provider" | "batchSize"> & Partial<Pick<GptSeoSettings, "language" | "instructions">>): Promise<GptSeoSettings> {
    if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 10) throw new Error("Batch size must be 1–10");
    if (!["gemini", "custom_gpt", "codex_mcp"].includes(settings.provider)) throw new Error("Invalid provider");
    return (await this.transaction(async () => {
      const previous = (await this.settings(storeId));
      const next = { ...previous, ...settings, version: previous.version + 1 };
      (await this.db.prepare("INSERT INTO gpt_settings VALUES (?,?) ON CONFLICT(store_id) DO UPDATE SET payload=excluded.payload").run(storeId, JSON.stringify(next)));
      return next;
    }));
  }
  async enqueue(rawInput: GptSeoEnqueue): Promise<GptSeoJob> {
    return this.enqueueRevision(rawInput);
  }
  private async enqueueRevision(rawInput: GptSeoEnqueue, previousJobId?: string): Promise<GptSeoJob> {
    const input = normalizeSeoEnqueue(rawInput);
    const { execution } = input;
    const inputHash = hash(input.input);
    const dedup = hash({ source: execution.source, identity: execution.sourceIdentity, revision: execution.sourceRevision, inputHash });
    return (await this.transaction(async () => {
      const existing = (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND dedup=?").get(execution.storeId, dedup));
      if (existing) return json(existing.payload) as GptSeoJob;
      const workerMode = await this.db.prepare("SELECT enabled FROM seo_worker_stores WHERE store_id=?").get(execution.storeId);
      if (workerMode) {
        const active = await this.db.prepare("SELECT job_id FROM seo_worker_jobs WHERE store_id=? AND product_key=? AND pipeline_active=true").get(execution.storeId, getWorkerProductKey(execution));
        if (active) throw new SeoWorkerError("ALREADY_IN_SEO_PIPELINE");
      }
      const olderJobs = (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceIdentity')=? AND status != 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM gpt_sync WHERE gpt_sync.job_id=gpt_jobs.id AND gpt_sync.status != 'ROLLED_BACK')").all(execution.storeId, execution.source, execution.sourceIdentity));
      for (const row of olderJobs) {
        const olderJob = json(row.payload) as GptSeoJob;
        // Explicit revisions preserve the entire ancestry, not only the immediate parent.
        if (previousJobId) continue;
        // Performance revisions preserve human review history, never requeue in place.
        if (input.performanceRecommendationId && olderJob.status === "REVIEW_READY") continue;
        await this.write({ ...olderJob, status: "CANCELLED", error: "Superseded by a newer source revision" });
      }
      const job: GptSeoJob = { ...input, id: randomUUID(), storeId: execution.storeId, source: execution.source,
        sourceIdentity: execution.sourceIdentity, sourceRevision: execution.sourceRevision, original: execution.originalSnapshot,
        inputHash, settings: input.settings ?? (await this.settings(execution.storeId)), status: "PENDING", checkpoints: {}, createdAt: this.now(), updatedAt: this.now() };
      (await this.db.prepare("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES (?,?,?,?,?,?,?)").run(job.id, job.storeId, dedup, job.status, JSON.stringify(job), job.createdAt, job.settings.provider));
      const versioningFlags = await this.versioning.getStoreFlags(job.storeId);
      if (versioningFlags.readEnabled && execution.productId) {
        await this.versioning.recordDraftBase({
          jobId: job.id,
          storeId: job.storeId,
          shopifyProductGid: `gid://shopify/Product/${execution.productId}`,
          inputContractVersion: SEO_WORKER_SCHEMA_VERSION,
          storeProfileVersion: input.input.storeProfile.profileVersion,
          createdAt: job.createdAt,
        });
      }
      if (workerMode) {
        await this.db.prepare("INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at) VALUES (?,?,?,'READY',?)").run(job.id, job.storeId, getWorkerProductKey(job.execution), this.now());
      }
      (await this.audit(job.storeId, job.id, "ENQUEUED"));
      return job;
    }));
  }
  async get(storeId: string, jobId: string): Promise<GptSeoJob> {
    const row = (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND id=?").get(storeId, jobId));
    if (!row) throw new Error("Job not found");
    return json(row.payload) as GptSeoJob;
  }
  async findLatestSourceJobs(storeId: string, source: string, productIds: readonly string[]): Promise<ReadonlyMap<string, GptSeoJob>> {
    const rows = await this.db.prepare("SELECT DISTINCT ON (json_extract(payload,'$.sourceIdentity')) payload FROM gpt_jobs WHERE store_id=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceIdentity')=ANY(?::text[]) AND status!='CANCELLED' ORDER BY json_extract(payload,'$.sourceIdentity'),created_at DESC,id DESC").all(storeId, source, productIds);
    return new Map(rows.map(row => { const job = json(row.payload) as GptSeoJob; return [job.sourceIdentity, job]; }));
  }
  async findLatestSourceJob(storeId: string, source: string, sourceIdentity: string): Promise<GptSeoJob | null> {
    const normalizedIdentity = source === "auto_seo"
      ? sourceIdentity.replace(/^gid:\/\/shopify\/Product\//, "")
      : sourceIdentity;
    const row = (await this.db.prepare(`
      SELECT payload FROM gpt_jobs
      WHERE store_id=?
        AND json_extract(payload,'$.source')=?
        AND json_extract(payload,'$.sourceIdentity')=?
        AND status != 'CANCELLED'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(storeId, source, normalizedIdentity));
    return row ? json(row.payload) as GptSeoJob : null;
  }
  async list(storeId: string, status?: GptJobStatus, offset = 0, provider?: ExternalSeoProvider): Promise<readonly GptSeoJob[]> {
    const rows = provider
      ? status
        ? (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, provider, status, offset))
        : (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, provider, offset))
      : status
        ? (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND status=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, status, offset))
        : (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, offset));
    return rows.map(row => json(row.payload) as GptSeoJob);
  }
  async listFiltered(storeId: string, filters: QueueListFilters, offset = 0): Promise<readonly GptSeoJob[]> {
    const statuses = [...new Set(filters.statuses ?? [])];
    const conditions = ["store_id=?"];
    const parameters: Array<string | number> = [storeId];
    if (filters.provider) {
      conditions.push("provider=?");
      parameters.push(filters.provider);
    }
    if (statuses.length > 0) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      parameters.push(...statuses);
    }
    parameters.push(offset);
    const rows = await this.db.prepare(`SELECT payload FROM gpt_jobs WHERE ${conditions.join(" AND ")} ORDER BY created_at,id LIMIT 50 OFFSET ?`).all(...parameters);
    return rows.map(row => json(row.payload) as GptSeoJob);
  }
  async countFiltered(storeId: string, filters: QueueListFilters): Promise<number> {
    const statuses = [...new Set(filters.statuses ?? [])];
    const conditions = ["store_id=?"];
    const parameters: string[] = [storeId];
    if (filters.provider) {
      conditions.push("provider=?");
      parameters.push(filters.provider);
    }
    if (statuses.length > 0) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      parameters.push(...statuses);
    }
    const row = await this.db.prepare(`SELECT COUNT(*) AS count FROM gpt_jobs WHERE ${conditions.join(" AND ")}`).get(...parameters);
    return Number(row?.count ?? 0);
  }
  async counts(storeId: string, provider?: ExternalSeoProvider): Promise<Readonly<Record<string, number>>> {
    const rows = provider
      ? (await this.db.prepare("SELECT status,COUNT(*) AS count FROM gpt_jobs WHERE store_id=? AND provider=? GROUP BY status").all(storeId, provider))
      : (await this.db.prepare("SELECT status,COUNT(*) AS count FROM gpt_jobs WHERE store_id=? GROUP BY status").all(storeId));
    return Object.fromEntries(rows.map(row => [String(row.status), Number(row.count)]));
  }
  private async write(job: GptSeoJob): Promise<void> {
    (await this.db.prepare("UPDATE gpt_jobs SET status=?,payload=?,provider=? WHERE id=? AND store_id=?").run(job.status, JSON.stringify({ ...job, updatedAt: this.now() }), job.settings.provider, job.id, job.storeId));
    if (job.status === "CANCELLED") {
      await this.db.prepare("UPDATE seo_worker_jobs SET state='CANCELLED',pipeline_active=false,lease_id=NULL,expires_at=NULL,updated_at=? WHERE job_id=?").run(this.now(), job.id);
      await this.db.prepare("UPDATE seo_worker_attempts SET ended_at=?,result='CANCELLED' WHERE job_id=? AND ended_at IS NULL").run(this.now(), job.id);
    }
  }
  private async audit(storeId: string, jobId: string, event: string): Promise<void> {
    (await this.db.prepare("INSERT INTO gpt_audit(store_id,job_id,event,created_at) VALUES (?,?,?,?)").run(storeId, jobId, event, this.now()));
  }
  private async expire(storeId: string, provider?: ExternalSeoProvider): Promise<void> {
    const expired = provider
      ? await this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND provider=? AND active=1 AND expires_at<=?").all(storeId, provider, this.now())
      : await this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND active=1 AND expires_at<=?").all(storeId, this.now());
    for (const batch of expired) (await this.releaseJobs(String(batch.id)));
  }
  private async releaseJobs(batchId: string): Promise<void> {
    for (const row of (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE batch_id=? AND status IN ('IN_PROGRESS','NEEDS_CHANGES')").all(batchId))) {
      (await this.write({ ...json(row.payload) as GptSeoJob, status: "PENDING" }));
    }
    (await this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE batch_id=?").run(batchId));
    (await this.db.prepare("UPDATE gpt_batches SET active=0 WHERE id=?").run(batchId));
  }
  async batch(storeId: string, batchId: string): Promise<GptSeoBatch> {
    const row = (await this.db.prepare("SELECT * FROM gpt_batches WHERE store_id=? AND id=?").get(storeId, batchId));
    if (!row) throw new Error("Batch not found");
    return { id: batchId, provider: String(row.provider) as ExternalSeoProvider, ownerId: String(row.owner_id), leaseToken: String(row.token), expiresAt: Number(row.expires_at), jobs: (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE batch_id=? ORDER BY created_at,id").all(batchId)).map(entry => { const job = json(entry.payload) as GptSeoJob; return { id: job.id, title: `SEO job ${job.id}`, status: job.status }; }) };
  }
  async activeBatch(storeId: string, ownerId: string): Promise<GptSeoBatch | null> {
    const row = (await this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND owner_id=? AND active=1 AND expires_at>? ORDER BY rowid LIMIT 1").get(storeId, ownerId, this.now()));
    return row ? (await this.batch(storeId, String(row.id))) : null;
  }
  async activeBatches(storeId: string): Promise<readonly GptSeoBatch[]> {
    return Promise.all((await this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND active=1 AND expires_at>? ORDER BY rowid").all(storeId, this.now())).map(async row => (await this.batch(storeId, String(row.id)))));
  }
  async claim(storeId: string, requestId: string, provider: ExternalSeoProvider, ownerId: string): Promise<GptSeoBatch> {
    if (!requestId || requestId.length > 120) throw new Error("Invalid request id");
    if (!ownerId || ownerId.length > 200) throw new Error("Invalid batch owner");
    return (await this.transaction(async () => {
      if (provider === "codex_mcp" && await this.db.prepare("SELECT enabled FROM seo_worker_stores WHERE store_id=?").get(storeId)) {
        throw new SeoWorkerError("WORKER_CLIENT_UPGRADE_REQUIRED");
      }
      if (provider === "codex_mcp" && await this.db.prepare("SELECT store_id FROM seo_worker_cutovers WHERE store_id=? AND draining=true").get(storeId)) throw new SeoWorkerError("WORKER_CUTOVER_DRAINING");
      (await this.expire(storeId));
      const duplicate = (await this.db.prepare("SELECT id,active,owner_id FROM gpt_batches WHERE store_id=? AND request_id=?").get(storeId, requestId));
      if (duplicate) {
        if (!duplicate.active) throw new Error("Batch lease expired; use a new request id");
        if (duplicate.owner_id !== ownerId) throw new Error("Request id belongs to another owner");
        const batch = (await this.batch(storeId, String(duplicate.id)));
        if (batch.provider !== provider) throw new Error("Request id belongs to another provider");
        return batch;
      }
      if ((await this.activeBatch(storeId, ownerId))) throw new Error("An active batch must be resumed or released first");
      const jobs = (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status='PENDING' ORDER BY created_at,id LIMIT ?").all(storeId, provider, (await this.settings(storeId)).batchSize));
      const batchId = randomUUID();
      (await this.db.prepare("INSERT INTO gpt_batches(id,store_id,request_id,token,expires_at,active,provider,owner_id) VALUES (?,?,?,?,?,?,?,?)").run(batchId, storeId, requestId, randomUUID(), this.now() + LEASE_MS, jobs.length ? 1 : 0, provider, ownerId));
      for (const row of jobs) {
        const job = json(row.payload) as GptSeoJob;
        (await this.write({ ...job, status: "IN_PROGRESS" }));
        (await this.db.prepare("UPDATE gpt_jobs SET batch_id=? WHERE id=?").run(batchId, job.id));
      }
      return (await this.batch(storeId, batchId));
    }));
  }
  async assertLease(storeId: string, batchId: string, token: string, jobId?: string): Promise<void> {
    const row = (await this.db.prepare("SELECT * FROM gpt_batches WHERE store_id=? AND id=? AND token=? AND active=1 AND expires_at>?").get(storeId, batchId, token, this.now()));
    if (!row) throw new Error("Invalid or expired batch lease");
    if (row.provider === "codex_mcp" && await this.db.prepare("SELECT enabled FROM seo_worker_stores WHERE store_id=?").get(storeId)) {
      throw new SeoWorkerError("WORKER_CLIENT_UPGRADE_REQUIRED");
    }
    if (jobId && !(await this.db.prepare("SELECT id FROM gpt_jobs WHERE id=? AND store_id=? AND batch_id=?").get(jobId, storeId, batchId))) throw new Error("Job lease mismatch");
  }
  async renew(storeId: string, batchId: string, token: string): Promise<GptSeoBatch> {
    return (await this.transaction(async () => { (await this.assertLease(storeId, batchId, token)); (await this.db.prepare("UPDATE gpt_batches SET expires_at=? WHERE id=?").run(this.now() + LEASE_MS, batchId)); return (await this.batch(storeId, batchId)); }));
  }
  async release(storeId: string, batchId: string, token: string): Promise<void> {
    (await this.transaction(async () => { (await this.assertLease(storeId, batchId, token)); (await this.releaseJobs(batchId)); }));
  }
  async checkpoint(storeId: string, jobId: string, mutation: GptCheckpointMutation): Promise<GptSeoJob> {
    return (await this.transaction(async () => {
      (await this.assertLease(storeId, mutation.batchId, mutation.leaseToken, jobId));
      const digest = hash(mutation.requestPayload ?? { stage: mutation.stage, payload: mutation.payload });
      const previous = (await this.db.prepare("SELECT digest FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, mutation.requestId));
      if (previous) {
        if (previous.digest !== digest) throw new Error("Idempotency key reused with different payload");
        return (await this.get(storeId, jobId));
      }
      const job = (await this.get(storeId, jobId));
      if (["VALIDATING", "REVIEW_READY", "CANCELLED"].includes(job.status)) throw new Error("Job does not accept checkpoints");
      const checkpoints = { ...job.checkpoints };
      const stages = ["analysis", "research", "keywords", "submission"] as const;
      for (const stage of stages.slice(stages.indexOf(mutation.stage) + 1)) delete checkpoints[stage];
      checkpoints[mutation.stage] = mutation.payload;
      const next: GptSeoJob = { ...job, status: mutation.stage === "submission" ? "VALIDATING" : "IN_PROGRESS", checkpoints, error: undefined };
      (await this.write(next));
      (await this.db.prepare("INSERT INTO gpt_mutations(scope,request_id,digest,response) VALUES (?,?,?,?)").run(jobId, mutation.requestId, digest, JSON.stringify({ payload: mutation.payload })));
      (await this.audit(storeId, jobId, mutation.stage));
      return (await this.get(storeId, jobId));
    }));
  }
  async replayMutation(jobId: string, requestId: string, requestPayload: unknown): Promise<{ payload: unknown } | undefined> {
    const row = (await this.db.prepare("SELECT digest,response FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, requestId));
    if (!row) return undefined;
    if (row.digest !== hash(requestPayload)) throw new Error("Idempotency key reused with different request");
    return row.response ? json(row.response) as { payload: unknown } : { payload: null };
  }
  async rememberMutation(jobId: string, requestId: string, requestPayload: unknown, payload: unknown): Promise<void> {
    (await this.transaction(async () => {
      const digest = hash(requestPayload);
      const previous = (await this.db.prepare("SELECT digest FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, requestId));
      if (previous) {
        if (previous.digest !== digest) throw new Error("Idempotency key reused with different request");
        return;
      }
      (await this.db.prepare("INSERT INTO gpt_mutations(scope,request_id,digest,response) VALUES (?,?,?,?)").run(jobId, requestId, digest, JSON.stringify({ payload })));
    }));
  }
  async issue(storeId: string, jobId: string, batchId: string, token: string, message: string): Promise<void> {
    (await this.transaction(async () => {
      (await this.assertLease(storeId, batchId, token, jobId));
      const job = (await this.get(storeId, jobId));
      if (!["IN_PROGRESS", "NEEDS_CHANGES", "WAITING_INPUT"].includes(job.status)) throw new Error("Job state does not accept issue reports");
      (await this.write({ ...job, status: "WAITING_INPUT", error: message.slice(0, 1000) }));
    }));
  }
  async retry(storeId: string, jobId: string): Promise<void> {
    (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if (!["WAITING_INPUT", "FAILED", "NEEDS_CHANGES"].includes(job.status)) throw new Error("Job cannot be retried in this state");
      (await this.write({ ...job, status: "PENDING", error: undefined, finalizeAttempts: 0, nextAttemptAt: undefined }));
      (await this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE id=?").run(jobId));
    }));
  }
  async requeue(storeId: string, jobId: string, options?: { provider?: SeoProvider; instructions?: string }): Promise<GptSeoJob> {
    return (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if ((await this.publisher.status(storeId, jobId)).managed) throw new Error("NEW_REVISION_REQUIRED: converted worker reviews cannot be reset in place");
      if ((await this.db.prepare("SELECT 1 FROM gpt_sync WHERE job_id=? AND status='SYNCING'").get(jobId))) {
        throw new Error("A Shopify sync is currently active for this review");
      }
      (await this.db.prepare("DELETE FROM gpt_sync WHERE job_id=? AND status IN ('UNKNOWN','SYNCING')").run(jobId));
      const nextSettings = {
        ...job.settings,
        ...(options?.provider ? { provider: options.provider } : {}),
        ...(options?.instructions !== undefined && options.instructions.trim() !== ""
          ? { instructions: options.instructions.trim() }
          : {}),
      };
      const updatedJob: GptSeoJob = {
        ...job,
        status: "PENDING",
        settings: nextSettings,
        error: undefined,
        finalizeAttempts: 0,
        nextAttemptAt: undefined,
        checkpoints: {},
        result: undefined,
        updatedAt: this.now(),
      };
      (await this.write(updatedJob));
      (await this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE id=?").run(jobId));
      (await this.audit(storeId, jobId, "JOB_REQUEUED"));
      return updatedJob;
    }));
  }
  async cancelReview(storeId: string, jobId: string): Promise<void> {
    (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if (await this.db.prepare("SELECT id FROM seo_publish_operations WHERE job_id=?").get(jobId)) throw new Error("BACKEND_PUBLISH_MANAGED: preserve the published review history");
      if (job.status !== "REVIEW_READY") throw new Error("Job is not a ready review");
      if ((await this.db.prepare("SELECT 1 FROM gpt_sync WHERE job_id=? AND status IN ('SYNCING','UNKNOWN')").get(jobId))) {
        throw new Error("A Shopify sync has already started for this review");
      }
      (await this.write({ ...job, status: "CANCELLED" }));
      (await this.audit(storeId, jobId, "REVIEW_CANCELLED"));
    }));
  }
  async pendingFinalization(): Promise<readonly GptSeoJob[]> {
    return (await this.transaction(async () => {
      const rows = (await this.db.prepare("SELECT payload FROM gpt_jobs WHERE status='VALIDATING' AND COALESCE(json_extract(payload,'$.nextAttemptAt'),0)<=? AND COALESCE(json_extract(payload,'$.finalizerUntil'),0)<=? ORDER BY created_at LIMIT 1").all(this.now(), this.now()));
      return Promise.all(rows.map(async row => {
        const job = { ...json(row.payload) as GptSeoJob, finalizerToken: randomUUID(), finalizerUntil: this.now() + 300_000 };
        (await this.write(job));
        return job;
      }));
    }));
  }
  async transfer(storeId: string, jobId: string, provider: SeoProvider): Promise<void> {
    (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      const lease = (await this.db.prepare("SELECT b.id FROM gpt_batches b JOIN gpt_jobs j ON j.batch_id=b.id WHERE j.id=? AND b.active=1 AND b.expires_at>?").get(jobId, this.now()));
      if (lease) throw new Error("Release the active batch lease before transferring a job");
      if (!["PENDING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED"].includes(job.status)) throw new Error("Only waiting jobs can change provider");
      (await this.write({ ...job, settings: { ...job.settings, provider }, status: provider === "gemini" ? "VALIDATING" : "PENDING", checkpoints: {}, finalizeAttempts: 0, nextAttemptAt: undefined, error: undefined }));
      (await this.audit(storeId, jobId, `PROVIDER_${provider}`));
    }));
  }
  async finish(storeId: string, jobId: string, result: unknown, finalizerToken?: string): Promise<void> {
    (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if (job.status === "REVIEW_READY") return;
      const worker = await this.db.prepare("SELECT lease_id,expires_at,run_id FROM seo_worker_jobs WHERE job_id=?").get(jobId);
      if (worker?.run_id && (!worker.lease_id || Number(worker.expires_at) <= this.now())) throw new SeoWorkerError("STALE_LEASE");
      if (finalizerToken && job.finalizerToken !== finalizerToken) throw new Error("Stale finalizer lease");
      if (job.status !== "VALIDATING") throw new Error("Job is not validating");
      (await this.write({ ...job, status: "REVIEW_READY", result, error: undefined }));
      // Review consumes job.result directly; the draft and its receipt commit together.
      (await this.db.prepare("INSERT INTO gpt_deliveries(job_id,payload,delivered) VALUES (?,?,1) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload,delivered=1").run(jobId, JSON.stringify(result)));
      (await this.audit(storeId, jobId, "REVIEW_READY"));
    }));
  }
  async resetReviewReadyForAeoBackfill(storeId: string, provider: ExternalSeoProvider): Promise<{ readonly resetCount: number; readonly jobIds: readonly string[] }> {
    return (await this.transaction(async () => {
      const rows = (await this.db.prepare("SELECT id,payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status='REVIEW_READY' ORDER BY created_at,id").all(storeId, provider));
      const jobIds = rows.map((row) => String(row.id));
      for (const jobId of jobIds) {
        const reviewStateRow = (await this.db.prepare("SELECT payload FROM gpt_review_state WHERE job_id=?").get(jobId));
        const reviewState = reviewStateRow ? record(json(reviewStateRow.payload)) : {};
        const sync = (await this.db.prepare("SELECT status FROM gpt_sync WHERE job_id=? AND status!='ROLLED_BACK'").get(jobId));
        if (reviewState.reviewDecision === "approved" || sync) {
          throw new Error(`Cannot reset approved or synchronized review ${jobId}`);
        }
      }
      for (const row of rows) {
        const job = json(row.payload) as GptSeoJob;
        (await this.write({
          ...job,
          status: "PENDING",
          // Keep the previous submission as read-only source material for the
          // external worker. A new submission checkpoint replaces it before
          // validation, while analysis, research and keywords remain reusable.
          checkpoints: job.checkpoints,
          result: undefined,
          error: undefined,
          finalizeAttempts: 0,
          nextAttemptAt: undefined,
          finalizerToken: undefined,
          finalizerUntil: undefined,
        }));
        (await this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE id=?").run(job.id));
        (await this.db.prepare("DELETE FROM gpt_deliveries WHERE job_id=?").run(job.id));
        (await this.db.prepare("DELETE FROM gpt_review_state WHERE job_id=?").run(job.id));
        (await this.audit(storeId, job.id, "AEO_BACKFILL_RESET"));
      }
      return { resetCount: jobIds.length, jobIds };
    }));
  }
  async failValidation(storeId: string, jobId: string, error: string, finalizerToken?: string): Promise<void> {
    (await this.transaction(async () => { const job = (await this.get(storeId, jobId)); if (job.status === "VALIDATING" && (!finalizerToken || job.finalizerToken === finalizerToken)) (await this.write({ ...job, status: "NEEDS_CHANGES", finalizerToken: undefined, finalizerUntil: undefined, error })); }));
  }
  async retryFinalization(storeId: string, jobId: string, error: string, finalizerToken?: string): Promise<void> {
    (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if (job.status !== "VALIDATING" || (finalizerToken && job.finalizerToken !== finalizerToken)) return;
      const attempts = (job.finalizeAttempts || 0) + 1;
      (await this.write({ ...job, finalizeAttempts: attempts, finalizerToken: undefined, finalizerUntil: undefined, status: attempts > 3 ? "FAILED" : "VALIDATING", nextAttemptAt: this.now() + [1000, 5000, 15000][Math.min(attempts - 1, 2)], error }));
    }));
  }
  async reviewState(storeId: string, jobId: string): Promise<Record<string, unknown>> {
    (await this.get(storeId, jobId));
    const row = (await this.db.prepare("SELECT payload FROM gpt_review_state WHERE job_id=?").get(jobId));
    const state = row ? record(json(row.payload)) : {};
    const publish = await this.publisher.status(storeId, jobId);
    const receipt = publish.operation;
    return { ...state, ...(publish.managed ? { backendPublishRequired: true } : {}), ...(receipt ? {
      backendPublish: { id: receipt.id, jobId, state: receipt.state, errorCode: receipt.errorCode, seoVersion: receipt.seoVersion },
      shopifySyncStatus: receipt.state === "SUCCEEDED" ? "synced" : receipt.state === "BLOCKED" ? "failed" : "syncing",
      isSyncing: !["SUCCEEDED", "BLOCKED"].includes(receipt.state),
      shopifySyncError: receipt.state === "BLOCKED" ? `Backend publish: ${receipt.errorCode}. Cần kiểm tra trước khi thử lại.` : undefined,
    } : {}) };
  }
  async saveReviewState(storeId: string, jobId: string, state: Record<string, unknown>): Promise<void> {
    await this.transaction(async () => {
    (await this.get(storeId, jobId));
    if (await this.db.prepare("SELECT job_id FROM seo_worker_revisions WHERE previous_job_id=?").get(jobId)) throw new Error("REVIEW_SUPERSEDED: preserve revision history");
    if (await this.db.prepare("SELECT id FROM seo_publish_operations WHERE job_id=?").get(jobId)) throw new Error("PUBLISH_ACTIVE: published review is immutable; create a new revision after reconciliation");
    const current = (await this.reviewState(storeId, jobId));
    if (typeof current.updatedAt === "number" && typeof state.updatedAt === "number" && state.updatedAt < current.updatedAt) throw new Error("Review conflict: a newer edit is already saved");
    (await this.db.prepare("INSERT INTO gpt_review_state VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload").run(jobId, JSON.stringify(state)));
    if (state.reviewDecision === "rejected") {
      await this.db.prepare("UPDATE seo_worker_jobs SET pipeline_active=false,state='CLOSED',updated_at=? WHERE job_id=? AND lease_id IS NULL").run(this.now(), jobId);
    }
    if (typeof state.lastRevertedAt === "number" && state.shopifySyncStatus === "idle" && state.lastRevertedAt > Number(current.lastRevertedAt || 0)) {
      (await this.db.prepare("UPDATE gpt_sync SET status='ROLLED_BACK' WHERE job_id=? AND status='SYNCED'").run(jobId));
    }
    });
  }
  async beginSync(storeId: string, jobId: string): Promise<string> {
    return (await this.transaction(async () => {
      const job = (await this.get(storeId, jobId));
      if (job.status !== "REVIEW_READY") throw new Error("Sync requires a ready review");
      if ((await this.versioning.getStoreFlags(storeId)).writeEnabled) {
        throw new Error("BACKEND_PUBLISH_REQUIRED: versioning-enabled stores cannot use the browser publisher");
      }
      if ((await this.publisher.status(storeId, jobId)).managed) throw new Error("BACKEND_PUBLISH_REQUIRED: use the operator publish endpoint");
      const newer = (await this.db.prepare("SELECT 1 FROM gpt_jobs WHERE store_id=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceIdentity')=? AND rowid>(SELECT rowid FROM gpt_jobs WHERE id=?) LIMIT 1").get(storeId, job.source, job.sourceIdentity, jobId));
      if (newer) throw new Error("Sync conflict: a newer source revision exists");
      if ((await this.reviewState(storeId, jobId)).reviewDecision !== "approved") throw new Error("Sync requires human approval saved on the server");
      const previous = (await this.db.prepare("SELECT status FROM gpt_sync WHERE job_id=?").get(jobId));
      if (previous && previous.status !== "ROLLED_BACK") throw new Error("Sync already started or completed; reconcile the existing operation before another write");
      if (previous) (await this.db.prepare("DELETE FROM gpt_sync WHERE job_id=? AND status='ROLLED_BACK'").run(jobId));
      const token = randomUUID();
      (await this.db.prepare("INSERT INTO gpt_sync VALUES (?,?,?)").run(jobId, token, "SYNCING"));
      return token;
    }));
  }
  async finishSync(storeId: string, jobId: string, token: string, status: "SYNCED" | "UNKNOWN" | "NOT_STARTED"): Promise<void> {
    await this.transaction(async () => {
      (await this.get(storeId, jobId));
      if (await this.db.prepare("SELECT id FROM seo_publish_operations WHERE job_id=?").get(jobId)) throw new Error("BACKEND_PUBLISH_MANAGED: browser cannot finish a durable publish");
      const result = status === "NOT_STARTED"
        ? (await this.db.prepare("DELETE FROM gpt_sync WHERE job_id=? AND token=? AND status='SYNCING'").run(jobId, token))
        : (await this.db.prepare("UPDATE gpt_sync SET status=? WHERE job_id=? AND token=? AND (status IN ('SYNCING','UNKNOWN') OR status=?)").run(status, jobId, token, status));
      if (!result.changes) throw new Error("Stale sync token");
      if (status === "SYNCED") await this.db.prepare("UPDATE seo_worker_jobs SET pipeline_active=false,state='CLOSED',updated_at=? WHERE job_id=? AND lease_id IS NULL").run(this.now(), jobId);
    });
  }
  async syncState(storeId: string, jobId: string): Promise<{ token: string; status: string } | null> {
    (await this.get(storeId, jobId));
    const row = (await this.db.prepare("SELECT token,status FROM gpt_sync WHERE job_id=?").get(jobId));
    return row ? { token: String(row.token), status: String(row.status) } : null;
  }
  async reconcileSync(storeId: string, jobId: string, input: { readonly token: string; readonly outcome: "SYNCED" | "NOT_WRITTEN"; readonly note: string }): Promise<void> {
    if (input.note.trim().length < 10 || input.note.length > 1000) throw new Error("Document the manual Shopify verification before reconciliation");
    (await this.transaction(async () => {
      (await this.get(storeId, jobId));
      const current = (await this.syncState(storeId, jobId));
      if (await this.db.prepare("SELECT id FROM seo_publish_operations WHERE job_id=?").get(jobId)) throw new Error("BACKEND_PUBLISH_MANAGED: use backend reconciliation");
      if (!current || current.token !== input.token || !["SYNCING", "UNKNOWN"].includes(current.status)) throw new Error("Stale sync reconciliation token or terminal state");
      (await this.db.prepare("UPDATE gpt_sync SET status=? WHERE job_id=? AND token=?").run(input.outcome === "SYNCED" ? "SYNCED" : "ROLLED_BACK", jobId, input.token));
      (await this.audit(storeId, jobId, `SYNC_RECONCILED_${input.outcome}: ${input.note.trim()}`));
    }));
  }
  async initialize(): Promise<void> { await this.db.initialize(); }
  async close(): Promise<void> { await this.db.close(); }
}
