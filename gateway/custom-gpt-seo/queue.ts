import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ExternalSeoProvider, GptCheckpointMutation, GptJobStatus, GptSeoBatch, GptSeoEnqueue, GptSeoJob, GptSeoSettings, SeoProvider } from "../../src/modules/custom-gpt-seo";
import { canonicalizeJson } from "../canonical-json";

const LEASE_MS = 30 * 60_000;
const DEFAULT_SETTINGS: GptSeoSettings = { provider: "gemini", batchSize: 5, version: 1, language: "en-US", instructions: "Use only grounded product facts. Never invent certifications, materials or performance claims." };
export interface QueueListFilters {
  readonly statuses?: readonly GptJobStatus[];
  readonly provider?: SeoProvider;
}
function hash(value: unknown): string { return createHash("sha256").update(canonicalizeJson(value)).digest("hex"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored record");
  return value as Record<string, unknown>;
}
function json(value: unknown): unknown { return JSON.parse(String(value)); }

/** SQLite transactions fence claims; the supplied clock makes lease tests deterministic. */
export class CustomGptQueue {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS gpt_settings (store_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gpt_jobs (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, dedup TEXT NOT NULL, status TEXT NOT NULL, batch_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT 'custom_gpt', UNIQUE(store_id,dedup));
      CREATE INDEX IF NOT EXISTS gpt_queue_idx ON gpt_jobs(store_id,status,created_at);
      CREATE TABLE IF NOT EXISTS gpt_batches (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, request_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, active INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT 'custom_gpt', owner_id TEXT NOT NULL DEFAULT 'custom_gpt', UNIQUE(store_id,request_id));
      CREATE TABLE IF NOT EXISTS gpt_mutations (scope TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT, PRIMARY KEY(scope,request_id));
      CREATE TABLE IF NOT EXISTS gpt_deliveries (job_id TEXT PRIMARY KEY, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS gpt_review_state (job_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gpt_sync (job_id TEXT PRIMARY KEY, token TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gpt_audit (id INTEGER PRIMARY KEY, store_id TEXT NOT NULL, job_id TEXT, event TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
    if (!db.prepare("PRAGMA table_info(gpt_jobs)").all().some(column => column.name === "provider")) db.exec("ALTER TABLE gpt_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'custom_gpt'");
    if (!db.prepare("PRAGMA table_info(gpt_batches)").all().some(column => column.name === "provider")) db.exec("ALTER TABLE gpt_batches ADD COLUMN provider TEXT NOT NULL DEFAULT 'custom_gpt'");
    const hasBatchOwner = db.prepare("PRAGMA table_info(gpt_batches)").all().some(column => column.name === "owner_id");
    if (!hasBatchOwner) {
      db.exec(`ALTER TABLE gpt_batches ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'custom_gpt';
        UPDATE gpt_batches SET owner_id=CASE WHEN provider='codex_mcp' THEN 'codex_mcp:default' ELSE 'custom_gpt' END;`);
    }
    db.exec(`UPDATE gpt_jobs SET provider=COALESCE(json_extract(payload,'$.settings.provider'),'custom_gpt');
      CREATE INDEX IF NOT EXISTS gpt_provider_queue_idx ON gpt_jobs(store_id,provider,status,created_at);`);
    if (!db.prepare("PRAGMA table_info(gpt_mutations)").all().some(column => column.name === "response")) db.exec("ALTER TABLE gpt_mutations ADD COLUMN response TEXT");
    db.exec("PRAGMA user_version=3");
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  settings(storeId: string): GptSeoSettings {
    const row = this.db.prepare("SELECT payload FROM gpt_settings WHERE store_id=?").get(storeId);
    return row ? json(row.payload) as GptSeoSettings : { ...DEFAULT_SETTINGS };
  }
  configure(storeId: string, settings: Pick<GptSeoSettings, "provider" | "batchSize"> & Partial<Pick<GptSeoSettings, "language" | "instructions">>): GptSeoSettings {
    if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 10) throw new Error("Batch size must be 1–10");
    if (!["gemini", "custom_gpt", "codex_mcp"].includes(settings.provider)) throw new Error("Invalid provider");
    return this.transaction(() => {
      const previous = this.settings(storeId);
      const next = { ...previous, ...settings, version: previous.version + 1 };
      this.db.prepare("INSERT INTO gpt_settings VALUES (?,?) ON CONFLICT(store_id) DO UPDATE SET payload=excluded.payload").run(storeId, JSON.stringify(next));
      return next;
    });
  }
  enqueue(rawInput: GptSeoEnqueue): GptSeoJob {
    const input: GptSeoEnqueue = { ...rawInput, sourceIdentity: rawInput.source === "auto_seo" ? rawInput.sourceIdentity.replace(/^gid:\/\/shopify\/Product\//, "") : rawInput.sourceIdentity, input: { ...rawInput.input, productId: rawInput.input.productId?.replace(/^gid:\/\/shopify\/Product\//, "") } };
    if (!input.storeId || !input.sourceIdentity || !input.input.title) throw new Error("Missing source identity or title");
    const inputHash = hash({ input: input.input, original: input.original, revision: input.sourceRevision });
    const dedup = hash({ source: input.source, identity: input.sourceIdentity, inputHash });
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND dedup=?").get(input.storeId, dedup);
      if (existing) return json(existing.payload) as GptSeoJob;
      const olderJobs = this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceIdentity')=? AND status != 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM gpt_sync WHERE gpt_sync.job_id=gpt_jobs.id AND gpt_sync.status != 'ROLLED_BACK')").all(input.storeId, input.source, input.sourceIdentity);
      for (const row of olderJobs) this.write({ ...json(row.payload) as GptSeoJob, status: "CANCELLED", error: "Superseded by a newer source revision" });
      const job: GptSeoJob = { ...input, id: randomUUID(), inputHash, settings: input.settings ?? this.settings(input.storeId), status: "PENDING", checkpoints: {}, createdAt: this.now(), updatedAt: this.now() };
      this.db.prepare("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES (?,?,?,?,?,?,?)").run(job.id, job.storeId, dedup, job.status, JSON.stringify(job), job.createdAt, job.settings.provider);
      this.audit(job.storeId, job.id, "ENQUEUED");
      return job;
    });
  }
  get(storeId: string, jobId: string): GptSeoJob {
    const row = this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND id=?").get(storeId, jobId);
    if (!row) throw new Error("Job not found");
    return json(row.payload) as GptSeoJob;
  }
  findLatestSourceJob(storeId: string, source: string, sourceIdentity: string): GptSeoJob | null {
    const normalizedIdentity = source === "auto_seo"
      ? sourceIdentity.replace(/^gid:\/\/shopify\/Product\//, "")
      : sourceIdentity;
    const row = this.db.prepare(`
      SELECT payload FROM gpt_jobs
      WHERE store_id=?
        AND json_extract(payload,'$.source')=?
        AND json_extract(payload,'$.sourceIdentity')=?
        AND status != 'CANCELLED'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(storeId, source, normalizedIdentity);
    return row ? json(row.payload) as GptSeoJob : null;
  }
  list(storeId: string, status?: GptJobStatus, offset = 0, provider?: ExternalSeoProvider): readonly GptSeoJob[] {
    const rows = provider
      ? status
        ? this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, provider, status, offset)
        : this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, provider, offset)
      : status
        ? this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND status=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, status, offset)
        : this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? ORDER BY created_at,id LIMIT 50 OFFSET ?").all(storeId, offset);
    return rows.map(row => json(row.payload) as GptSeoJob);
  }
  listFiltered(storeId: string, filters: QueueListFilters, offset = 0): readonly GptSeoJob[] {
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
    const rows = this.db.prepare(`SELECT payload FROM gpt_jobs WHERE ${conditions.join(" AND ")} ORDER BY created_at,id LIMIT 50 OFFSET ?`).all(...parameters);
    return rows.map(row => json(row.payload) as GptSeoJob);
  }
  countFiltered(storeId: string, filters: QueueListFilters): number {
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
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM gpt_jobs WHERE ${conditions.join(" AND ")}`).get(...parameters);
    return Number(row?.count ?? 0);
  }
  counts(storeId: string, provider?: ExternalSeoProvider): Readonly<Record<string, number>> {
    const rows = provider
      ? this.db.prepare("SELECT status,COUNT(*) AS count FROM gpt_jobs WHERE store_id=? AND provider=? GROUP BY status").all(storeId, provider)
      : this.db.prepare("SELECT status,COUNT(*) AS count FROM gpt_jobs WHERE store_id=? GROUP BY status").all(storeId);
    return Object.fromEntries(rows.map(row => [String(row.status), Number(row.count)]));
  }
  private write(job: GptSeoJob): void {
    this.db.prepare("UPDATE gpt_jobs SET status=?,payload=?,provider=? WHERE id=? AND store_id=?").run(job.status, JSON.stringify({ ...job, updatedAt: this.now() }), job.settings.provider, job.id, job.storeId);
  }
  private audit(storeId: string, jobId: string, event: string): void {
    this.db.prepare("INSERT INTO gpt_audit(store_id,job_id,event,created_at) VALUES (?,?,?,?)").run(storeId, jobId, event, this.now());
  }
  private expire(storeId: string): void {
    const expired = this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND active=1 AND expires_at<=?").all(storeId, this.now());
    for (const batch of expired) this.releaseJobs(String(batch.id));
  }
  private releaseJobs(batchId: string): void {
    for (const row of this.db.prepare("SELECT payload FROM gpt_jobs WHERE batch_id=? AND status IN ('IN_PROGRESS','NEEDS_CHANGES')").all(batchId)) {
      this.write({ ...json(row.payload) as GptSeoJob, status: "PENDING" });
    }
    this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE batch_id=?").run(batchId);
    this.db.prepare("UPDATE gpt_batches SET active=0 WHERE id=?").run(batchId);
  }
  batch(storeId: string, batchId: string): GptSeoBatch {
    const row = this.db.prepare("SELECT * FROM gpt_batches WHERE store_id=? AND id=?").get(storeId, batchId);
    if (!row) throw new Error("Batch not found");
    return { id: batchId, provider: String(row.provider) as ExternalSeoProvider, ownerId: String(row.owner_id), leaseToken: String(row.token), expiresAt: Number(row.expires_at), jobs: this.db.prepare("SELECT payload FROM gpt_jobs WHERE batch_id=? ORDER BY created_at,id").all(batchId).map(entry => { const job = json(entry.payload) as GptSeoJob; return { id: job.id, title: job.input.title, status: job.status }; }) };
  }
  activeBatch(storeId: string, ownerId: string): GptSeoBatch | null {
    const row = this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND owner_id=? AND active=1 AND expires_at>? ORDER BY rowid LIMIT 1").get(storeId, ownerId, this.now());
    return row ? this.batch(storeId, String(row.id)) : null;
  }
  activeBatches(storeId: string): readonly GptSeoBatch[] {
    return this.db.prepare("SELECT id FROM gpt_batches WHERE store_id=? AND active=1 AND expires_at>? ORDER BY rowid").all(storeId, this.now()).map(row => this.batch(storeId, String(row.id)));
  }
  claim(storeId: string, requestId: string, provider: ExternalSeoProvider, ownerId: string): GptSeoBatch {
    if (!requestId || requestId.length > 120) throw new Error("Invalid request id");
    if (!ownerId || ownerId.length > 200) throw new Error("Invalid batch owner");
    return this.transaction(() => {
      this.expire(storeId);
      const duplicate = this.db.prepare("SELECT id,active,owner_id FROM gpt_batches WHERE store_id=? AND request_id=?").get(storeId, requestId);
      if (duplicate) {
        if (!duplicate.active) throw new Error("Batch lease expired; use a new request id");
        if (duplicate.owner_id !== ownerId) throw new Error("Request id belongs to another owner");
        const batch = this.batch(storeId, String(duplicate.id));
        if (batch.provider !== provider) throw new Error("Request id belongs to another provider");
        return batch;
      }
      if (this.activeBatch(storeId, ownerId)) throw new Error("An active batch must be resumed or released first");
      const jobs = this.db.prepare("SELECT payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status='PENDING' ORDER BY created_at,id LIMIT ?").all(storeId, provider, this.settings(storeId).batchSize);
      const batchId = randomUUID();
      this.db.prepare("INSERT INTO gpt_batches(id,store_id,request_id,token,expires_at,active,provider,owner_id) VALUES (?,?,?,?,?,?,?,?)").run(batchId, storeId, requestId, randomUUID(), this.now() + LEASE_MS, jobs.length ? 1 : 0, provider, ownerId);
      for (const row of jobs) {
        const job = json(row.payload) as GptSeoJob;
        this.write({ ...job, status: "IN_PROGRESS" });
        this.db.prepare("UPDATE gpt_jobs SET batch_id=? WHERE id=?").run(batchId, job.id);
      }
      return this.batch(storeId, batchId);
    });
  }
  assertLease(storeId: string, batchId: string, token: string, jobId?: string): void {
    const row = this.db.prepare("SELECT * FROM gpt_batches WHERE store_id=? AND id=? AND token=? AND active=1 AND expires_at>?").get(storeId, batchId, token, this.now());
    if (!row) throw new Error("Invalid or expired batch lease");
    if (jobId && !this.db.prepare("SELECT id FROM gpt_jobs WHERE id=? AND store_id=? AND batch_id=?").get(jobId, storeId, batchId)) throw new Error("Job lease mismatch");
  }
  renew(storeId: string, batchId: string, token: string): GptSeoBatch {
    return this.transaction(() => { this.assertLease(storeId, batchId, token); this.db.prepare("UPDATE gpt_batches SET expires_at=? WHERE id=?").run(this.now() + LEASE_MS, batchId); return this.batch(storeId, batchId); });
  }
  release(storeId: string, batchId: string, token: string): void {
    this.transaction(() => { this.assertLease(storeId, batchId, token); this.releaseJobs(batchId); });
  }
  checkpoint(storeId: string, jobId: string, mutation: GptCheckpointMutation): GptSeoJob {
    return this.transaction(() => {
      this.assertLease(storeId, mutation.batchId, mutation.leaseToken, jobId);
      const digest = hash(mutation.requestPayload ?? { stage: mutation.stage, payload: mutation.payload });
      const previous = this.db.prepare("SELECT digest FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, mutation.requestId);
      if (previous) {
        if (previous.digest !== digest) throw new Error("Idempotency key reused with different payload");
        return this.get(storeId, jobId);
      }
      const job = this.get(storeId, jobId);
      if (["VALIDATING", "REVIEW_READY", "CANCELLED"].includes(job.status)) throw new Error("Job does not accept checkpoints");
      const checkpoints = { ...job.checkpoints };
      const stages = ["analysis", "research", "keywords", "submission"] as const;
      for (const stage of stages.slice(stages.indexOf(mutation.stage) + 1)) delete checkpoints[stage];
      checkpoints[mutation.stage] = mutation.payload;
      const next: GptSeoJob = { ...job, status: mutation.stage === "submission" ? "VALIDATING" : "IN_PROGRESS", checkpoints, error: undefined };
      this.write(next);
      this.db.prepare("INSERT INTO gpt_mutations(scope,request_id,digest,response) VALUES (?,?,?,?)").run(jobId, mutation.requestId, digest, JSON.stringify({ payload: mutation.payload }));
      this.audit(storeId, jobId, mutation.stage);
      return this.get(storeId, jobId);
    });
  }
  replayMutation(jobId: string, requestId: string, requestPayload: unknown): { payload: unknown } | undefined {
    const row = this.db.prepare("SELECT digest,response FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, requestId);
    if (!row) return undefined;
    if (row.digest !== hash(requestPayload)) throw new Error("Idempotency key reused with different request");
    return row.response ? json(row.response) as { payload: unknown } : { payload: null };
  }
  rememberMutation(jobId: string, requestId: string, requestPayload: unknown, payload: unknown): void {
    this.transaction(() => {
      const digest = hash(requestPayload);
      const previous = this.db.prepare("SELECT digest FROM gpt_mutations WHERE scope=? AND request_id=?").get(jobId, requestId);
      if (previous) {
        if (previous.digest !== digest) throw new Error("Idempotency key reused with different request");
        return;
      }
      this.db.prepare("INSERT INTO gpt_mutations(scope,request_id,digest,response) VALUES (?,?,?,?)").run(jobId, requestId, digest, JSON.stringify({ payload }));
    });
  }
  issue(storeId: string, jobId: string, batchId: string, token: string, message: string): void {
    this.transaction(() => {
      this.assertLease(storeId, batchId, token, jobId);
      const job = this.get(storeId, jobId);
      if (!["IN_PROGRESS", "NEEDS_CHANGES", "WAITING_INPUT"].includes(job.status)) throw new Error("Job state does not accept issue reports");
      this.write({ ...job, status: "WAITING_INPUT", error: message.slice(0, 1000) });
    });
  }
  retry(storeId: string, jobId: string): void {
    this.transaction(() => {
      const job = this.get(storeId, jobId);
      if (!["WAITING_INPUT", "FAILED", "NEEDS_CHANGES"].includes(job.status)) throw new Error("Job cannot be retried in this state");
      this.write({ ...job, status: "PENDING", error: undefined, finalizeAttempts: 0, nextAttemptAt: undefined });
      this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE id=?").run(jobId);
    });
  }
  cancelReview(storeId: string, jobId: string): void {
    this.transaction(() => {
      const job = this.get(storeId, jobId);
      if (job.status !== "REVIEW_READY") throw new Error("Job is not a ready review");
      if (this.db.prepare("SELECT 1 FROM gpt_sync WHERE job_id=? AND status IN ('SYNCING','UNKNOWN')").get(jobId)) {
        throw new Error("A Shopify sync has already started for this review");
      }
      this.write({ ...job, status: "CANCELLED" });
      this.audit(storeId, jobId, "REVIEW_CANCELLED");
    });
  }
  pendingFinalization(): readonly GptSeoJob[] {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT payload FROM gpt_jobs WHERE status='VALIDATING' AND COALESCE(json_extract(payload,'$.nextAttemptAt'),0)<=? AND COALESCE(json_extract(payload,'$.finalizerUntil'),0)<=? ORDER BY created_at LIMIT 1").all(this.now(), this.now());
      return rows.map(row => {
        const job = { ...json(row.payload) as GptSeoJob, finalizerToken: randomUUID(), finalizerUntil: this.now() + 300_000 };
        this.write(job);
        return job;
      });
    });
  }
  transfer(storeId: string, jobId: string, provider: SeoProvider): void {
    this.transaction(() => {
      const job = this.get(storeId, jobId);
      const lease = this.db.prepare("SELECT b.id FROM gpt_batches b JOIN gpt_jobs j ON j.batch_id=b.id WHERE j.id=? AND b.active=1 AND b.expires_at>?").get(jobId, this.now());
      if (lease) throw new Error("Release the active batch lease before transferring a job");
      if (!["PENDING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED"].includes(job.status)) throw new Error("Only waiting jobs can change provider");
      this.write({ ...job, settings: { ...job.settings, provider }, status: provider === "gemini" ? "VALIDATING" : "PENDING", checkpoints: {}, finalizeAttempts: 0, nextAttemptAt: undefined, error: undefined });
      this.audit(storeId, jobId, `PROVIDER_${provider}`);
    });
  }
  finish(storeId: string, jobId: string, result: unknown, finalizerToken?: string): void {
    this.transaction(() => {
      const job = this.get(storeId, jobId);
      if (job.status === "REVIEW_READY") return;
      if (finalizerToken && job.finalizerToken !== finalizerToken) throw new Error("Stale finalizer lease");
      if (job.status !== "VALIDATING") throw new Error("Job is not validating");
      this.write({ ...job, status: "REVIEW_READY", result, error: undefined });
      this.db.prepare("INSERT INTO gpt_deliveries(job_id,payload,delivered) VALUES (?,?,0) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload,delivered=0").run(jobId, JSON.stringify(result));
      this.audit(storeId, jobId, "REVIEW_READY");
    });
  }
  resetReviewReadyForAeoBackfill(storeId: string, provider: ExternalSeoProvider): { readonly resetCount: number; readonly jobIds: readonly string[] } {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT id,payload FROM gpt_jobs WHERE store_id=? AND provider=? AND status='REVIEW_READY' ORDER BY created_at,id").all(storeId, provider);
      const jobIds = rows.map((row) => String(row.id));
      for (const jobId of jobIds) {
        const reviewStateRow = this.db.prepare("SELECT payload FROM gpt_review_state WHERE job_id=?").get(jobId);
        const reviewState = reviewStateRow ? record(json(reviewStateRow.payload)) : {};
        const sync = this.db.prepare("SELECT status FROM gpt_sync WHERE job_id=? AND status!='ROLLED_BACK'").get(jobId);
        if (reviewState.reviewDecision === "approved" || sync) {
          throw new Error(`Cannot reset approved or synchronized review ${jobId}`);
        }
      }
      for (const row of rows) {
        const job = json(row.payload) as GptSeoJob;
        this.write({
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
        });
        this.db.prepare("UPDATE gpt_jobs SET batch_id=NULL WHERE id=?").run(job.id);
        this.db.prepare("DELETE FROM gpt_deliveries WHERE job_id=?").run(job.id);
        this.db.prepare("DELETE FROM gpt_review_state WHERE job_id=?").run(job.id);
        this.audit(storeId, job.id, "AEO_BACKFILL_RESET");
      }
      return { resetCount: jobIds.length, jobIds };
    });
  }
  failValidation(storeId: string, jobId: string, error: string, finalizerToken?: string): void {
    this.transaction(() => { const job = this.get(storeId, jobId); if (job.status === "VALIDATING" && (!finalizerToken || job.finalizerToken === finalizerToken)) this.write({ ...job, status: "NEEDS_CHANGES", finalizerToken: undefined, finalizerUntil: undefined, error }); });
  }
  retryFinalization(storeId: string, jobId: string, error: string, finalizerToken?: string): void {
    this.transaction(() => {
      const job = this.get(storeId, jobId);
      if (job.status !== "VALIDATING" || (finalizerToken && job.finalizerToken !== finalizerToken)) return;
      const attempts = (job.finalizeAttempts || 0) + 1;
      this.write({ ...job, finalizeAttempts: attempts, finalizerToken: undefined, finalizerUntil: undefined, status: attempts > 3 ? "FAILED" : "VALIDATING", nextAttemptAt: this.now() + [1000, 5000, 15000][Math.min(attempts - 1, 2)], error });
    });
  }
  reviewState(storeId: string, jobId: string): Record<string, unknown> {
    this.get(storeId, jobId);
    const row = this.db.prepare("SELECT payload FROM gpt_review_state WHERE job_id=?").get(jobId);
    return row ? record(json(row.payload)) : {};
  }
  saveReviewState(storeId: string, jobId: string, state: Record<string, unknown>): void {
    this.get(storeId, jobId);
    const current = this.reviewState(storeId, jobId);
    if (typeof current.updatedAt === "number" && typeof state.updatedAt === "number" && state.updatedAt < current.updatedAt) throw new Error("Review conflict: a newer edit is already saved");
    this.db.prepare("INSERT INTO gpt_review_state VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload").run(jobId, JSON.stringify(state));
    if (typeof state.lastRevertedAt === "number" && state.shopifySyncStatus === "idle" && state.lastRevertedAt > Number(current.lastRevertedAt || 0)) {
      this.db.prepare("UPDATE gpt_sync SET status='ROLLED_BACK' WHERE job_id=? AND status='SYNCED'").run(jobId);
    }
  }
  beginSync(storeId: string, jobId: string): string {
    return this.transaction(() => {
      const job = this.get(storeId, jobId);
      if (job.status !== "REVIEW_READY") throw new Error("Sync requires a ready review");
      const newer = this.db.prepare("SELECT 1 FROM gpt_jobs WHERE store_id=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceIdentity')=? AND rowid>(SELECT rowid FROM gpt_jobs WHERE id=?) LIMIT 1").get(storeId, job.source, job.sourceIdentity, jobId);
      if (newer) throw new Error("Sync conflict: a newer source revision exists");
      if (this.reviewState(storeId, jobId).reviewDecision !== "approved") throw new Error("Sync requires human approval saved on the server");
      const previous = this.db.prepare("SELECT status FROM gpt_sync WHERE job_id=?").get(jobId);
      if (previous && previous.status !== "ROLLED_BACK") throw new Error("Sync already started or completed; reconcile the existing operation before another write");
      if (previous) this.db.prepare("DELETE FROM gpt_sync WHERE job_id=? AND status='ROLLED_BACK'").run(jobId);
      const token = randomUUID();
      this.db.prepare("INSERT INTO gpt_sync VALUES (?,?,?)").run(jobId, token, "SYNCING");
      return token;
    });
  }
  finishSync(storeId: string, jobId: string, token: string, status: "SYNCED" | "UNKNOWN" | "NOT_STARTED"): void {
    this.get(storeId, jobId);
    const result = status === "NOT_STARTED"
      ? this.db.prepare("DELETE FROM gpt_sync WHERE job_id=? AND token=? AND status='SYNCING'").run(jobId, token)
      : this.db.prepare("UPDATE gpt_sync SET status=? WHERE job_id=? AND token=? AND (status IN ('SYNCING','UNKNOWN') OR status=?)").run(status, jobId, token, status);
    if (!result.changes) throw new Error("Stale sync token");
  }
  syncState(storeId: string, jobId: string): { token: string; status: string } | null {
    this.get(storeId, jobId);
    const row = this.db.prepare("SELECT token,status FROM gpt_sync WHERE job_id=?").get(jobId);
    return row ? { token: String(row.token), status: String(row.status) } : null;
  }
  reconcileSync(storeId: string, jobId: string, input: { readonly token: string; readonly outcome: "SYNCED" | "NOT_WRITTEN"; readonly note: string }): void {
    if (input.note.trim().length < 10 || input.note.length > 1000) throw new Error("Document the manual Shopify verification before reconciliation");
    this.transaction(() => {
      this.get(storeId, jobId);
      const current = this.syncState(storeId, jobId);
      if (!current || current.token !== input.token || !["SYNCING", "UNKNOWN"].includes(current.status)) throw new Error("Stale sync reconciliation token or terminal state");
      this.db.prepare("UPDATE gpt_sync SET status=? WHERE job_id=? AND token=?").run(input.outcome === "SYNCED" ? "SYNCED" : "ROLLED_BACK", jobId, input.token);
      this.audit(storeId, jobId, `SYNC_RECONCILED_${input.outcome}: ${input.note.trim()}`);
    });
  }
}
