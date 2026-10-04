import { createHash, randomBytes, randomUUID } from "node:crypto";

import { canonicalizeJson } from "../canonical-json";
import type { GptSeoJob, GptStage } from "../../src/modules/custom-gpt-seo";

import type { WorkerDatabase, WorkerSql } from "./database";
import type { WorkerLease, WorkerPrincipal, WorkerRun } from "./protocol";
import { getRetryDelay, getWorkerProductKey, SeoWorkerError, validateTargetCount, WORKER_DEFAULTS } from "./protocol";
import type { AgentAccessPage, AgentRunPage } from "../../src/modules/custom-gpt-seo";
import { SeoWorkerMetrics } from "./metrics";
import { migrateLegacyWorkerJob } from "./job-migration";

function digest(value: unknown): string { return createHash("sha256").update(canonicalizeJson(value)).digest("hex"); }
function requireLabel(value: string): void {
  if (!value.trim() || value.length > 200 || /[\x00-\x1f]/.test(value)) throw new SeoWorkerError("INVALID_IDENTIFIER");
}
function runOutput(row: Record<string, unknown>): WorkerRun {
  return { id: String(row.id), target: Number(row.target), successful: Number(row.successful),
    state: row.state as WorkerRun["state"], stopReason: row.stop_reason === null ? null : String(row.stop_reason) };
}
function leaseOutput(row: Record<string, unknown>): WorkerLease {
  return { jobId: String(row.job_id), runId: String(row.run_id), sessionId: String(row.session_id),
    leaseId: String(row.lease_id), leaseVersion: Number(row.lease_version), expiresAt: Number(row.expires_at) };
}

export class SeoWorkerRepository {
  readonly metrics: SeoWorkerMetrics;
  constructor(private readonly database: WorkerDatabase, private readonly now: () => number = Date.now,
    private readonly jitter: () => number = Math.random) { this.metrics = new SeoWorkerMetrics(database, now); }

  async listAccess(storeId: string, offset: number): Promise<AgentAccessPage> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new SeoWorkerError("INVALID_OFFSET");
    return this.database.transaction(async sql => {
      const total = Number((await sql.query("SELECT count(*) AS total FROM seo_worker_tokens WHERE store_id=$1 OR store_ids @> jsonb_build_array($1::text)", [storeId])).rows[0].total);
      const rows = (await sql.query(`SELECT t.id,t.store_id,t.store_ids,t.worker_id,t.created_by,t.expires_at,t.revoked_at,t.last_used_at,
        (SELECT w.job_id FROM seo_worker_jobs w WHERE w.token_id=t.id AND w.lease_id IS NOT NULL LIMIT 1) AS job_id
        FROM seo_worker_tokens t WHERE t.store_id=$1 OR t.store_ids @> jsonb_build_array($1::text) ORDER BY t.created_at DESC,t.id LIMIT 50 OFFSET $2`, [storeId, offset])).rows;
      const mode = (await sql.query("SELECT enabled FROM seo_worker_stores WHERE store_id=$1", [storeId])).rows[0];
      return { total, nextOffset: offset + rows.length < total ? offset + rows.length : null, claimsEnabled: mode?.enabled === true,
        tokens: rows.map(row => ({ id: String(row.id), workerId: String(row.worker_id), createdBy: String(row.created_by),
          storeIds: [...new Set([String(row.store_id), ...(Array.isArray(row.store_ids) ? row.store_ids.filter((value): value is string => typeof value === "string") : [])])],
          expiresAt: Number(row.expires_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
          lastSeenAt: row.last_used_at === null ? null : Number(row.last_used_at), jobId: row.job_id === null ? null : String(row.job_id) })) };
    });
  }

  async listRuns(storeId: string, offset: number): Promise<AgentRunPage> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new SeoWorkerError("INVALID_OFFSET");
    return this.database.transaction(async sql => {
      const total = Number((await sql.query("SELECT count(*) AS total FROM seo_worker_runs WHERE store_id=$1", [storeId])).rows[0].total);
      const rows = (await sql.query("SELECT * FROM seo_worker_runs WHERE store_id=$1 ORDER BY created_at DESC,id LIMIT 50 OFFSET $2", [storeId, offset])).rows;
      return { total, nextOffset: offset + rows.length < total ? offset + rows.length : null,
        runs: rows.map(row => ({ ...runOutput(row), workerId: String(row.worker_id) })) };
    });
  }

  async issueToken(input: { storeId: string; workerId: string; createdBy: string; storeIds?: readonly string[] }): Promise<{ token: string; tokenId: string; expiresAt: number }> {
    const storeIds = [...new Set([input.storeId, ...(input.storeIds ?? [])])];
    for (const value of [input.storeId, input.workerId, input.createdBy, ...storeIds]) requireLabel(value);
    const token = `ffp_worker_${randomBytes(32).toString("base64url")}`;
    const tokenId = randomUUID();
    const expiresAt = this.now() + WORKER_DEFAULTS.tokenMs;
    await this.database.transaction(async sql => {
      await sql.query(`INSERT INTO seo_worker_tokens(id,store_id,worker_id,token_hash,created_by,created_at,expires_at,store_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tokenId, input.storeId, input.workerId, digest(token), input.createdBy, this.now(), expiresAt, JSON.stringify(storeIds)]);
    });
    return { token, tokenId, expiresAt };
  }

  private async authenticate(sql: WorkerSql, token: string): Promise<WorkerPrincipal> {
    const row = (await sql.query("SELECT * FROM seo_worker_tokens WHERE token_hash=$1 FOR UPDATE", [digest(token)])).rows[0];
    if (!row) throw new SeoWorkerError("INVALID_TOKEN");
    if (row.revoked_at !== null) throw new SeoWorkerError("TOKEN_REVOKED");
    if (Number(row.expires_at) <= this.now()) throw new SeoWorkerError("TOKEN_EXPIRED");
    await sql.query("UPDATE seo_worker_tokens SET last_used_at=$2 WHERE id=$1", [row.id, this.now()]);
    const storeIds = [...new Set([String(row.store_id), ...(Array.isArray(row.store_ids) ? row.store_ids.filter((value): value is string => typeof value === "string") : [])])];
    const storeId = String(row.selected_store_id ?? row.store_id);
    if (!storeIds.includes(storeId)) throw new SeoWorkerError("STORE_NOT_AUTHORIZED");
    return { tokenId: String(row.id), storeId, storeIds, workerId: String(row.worker_id), expiresAt: Number(row.expires_at) };
  }

  async identify(token: string): Promise<WorkerPrincipal> {
    return this.database.transaction(sql => this.authenticate(sql, token));
  }

  async selectStore(token: string, storeId: string, expectedStoreId: string, requestId: string): Promise<WorkerPrincipal> {
    requireLabel(storeId);
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      if (!principal.storeIds.includes(storeId)) throw new SeoWorkerError("STORE_NOT_AUTHORIZED");
      return this.idempotent(sql, `${principal.tokenId}:select-store`, requestId, { storeId, expectedStoreId }, async () => {
        if (principal.storeId !== expectedStoreId) throw new SeoWorkerError("STORE_SELECTION_CHANGED");
        if (storeId === principal.storeId) return principal;
        // Locking the token serializes selection with claim, heartbeat and revoke.
        const busy = (await sql.query(`SELECT 1 FROM seo_worker_jobs WHERE token_id=$1 AND lease_id IS NOT NULL
          UNION ALL SELECT 1 FROM seo_worker_runs WHERE state='RUNNING'
          AND session_id IN (SELECT id FROM seo_worker_sessions WHERE token_id=$1) LIMIT 1`, [principal.tokenId])).rows;
        if (busy.length) throw new SeoWorkerError("WORKER_BUSY_FINISH_RUN_FIRST");
        await sql.query("UPDATE seo_worker_sessions SET active=false WHERE token_id=$1", [principal.tokenId]);
        await sql.query("UPDATE seo_worker_tokens SET selected_store_id=$2 WHERE id=$1", [principal.tokenId, storeId]);
        return { ...principal, storeId };
      });
    });
  }

  async queueStatus(token: string): Promise<{ counts: Readonly<Record<string, number>> }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      const rows = (await sql.query(`SELECT w.state,count(*) AS count FROM seo_worker_jobs w JOIN gpt_jobs j ON j.id=w.job_id
        WHERE w.store_id=$1 AND j.provider='codex_mcp' GROUP BY w.state`, [principal.storeId])).rows;
      return { counts: Object.fromEntries(rows.map(row => [String(row.state), Number(row.count)])) };
    });
  }

  async finishWorker(token: string, sessionId: string, requestId: string): Promise<{ finished: true }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      return this.idempotent(sql, `${principal.tokenId}:worker-finish`, requestId, { sessionId }, async () => {
        await this.session(sql, principal, sessionId);
        for (const row of (await sql.query("SELECT * FROM seo_worker_jobs WHERE session_id=$1 AND lease_id IS NOT NULL FOR UPDATE", [sessionId])).rows) await this.endLease(sql, row, "WORKER_STOPPED", true);
        await sql.query("UPDATE seo_worker_runs SET state='PARTIAL',stop_reason='WORKER_STOPPED',updated_at=$2 WHERE session_id=$1 AND state='RUNNING'", [sessionId, this.now()]);
        await sql.query("UPDATE seo_worker_sessions SET active=false WHERE id=$1", [sessionId]);
        return { finished: true as const };
      });
    });
  }

  async readJob(token: string, lease: WorkerLease): Promise<GptSeoJob> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.assertLease(sql, principal, lease);
      const row = (await sql.query("SELECT payload FROM gpt_jobs WHERE id=$1 AND store_id=$2", [lease.jobId, principal.storeId])).rows[0];
      if (!row) throw new SeoWorkerError("JOB_NOT_FOUND");
      return JSON.parse(String(row.payload)) as GptSeoJob;
    });
  }

  async saveCheckpoint(token: string, lease: WorkerLease, input: {
    readonly requestId: string; readonly stage: GptStage; readonly payload: unknown; readonly expectedCheckpoints: unknown; readonly requestPayload?: unknown;
  }): Promise<{ jobId: string; status: string }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, lease.sessionId);
      const scope = `${principal.tokenId}:${lease.jobId}:${lease.leaseVersion}:checkpoint`;
      // A committed receipt survives completion, but only its original authenticated session can retrieve it.
      return this.idempotent(sql, scope, input.requestId, input.requestPayload ?? { stage: input.stage, payload: input.payload }, async () => {
        const worker = await this.assertLease(sql, principal, lease);
        const row = (await sql.query("SELECT payload FROM gpt_jobs WHERE id=$1 FOR UPDATE", [lease.jobId])).rows[0];
        const job = JSON.parse(String(row.payload)) as GptSeoJob;
        if (input.stage === "analysis") {
          const receipts = (await sql.query("SELECT image_id FROM seo_worker_image_receipts WHERE job_id=$1 AND lease_version=$2", [job.id, lease.leaseVersion])).rows;
          if (job.input.images?.some((image, index) => !receipts.some(receipt => receipt.image_id === (image.id || `image-${index + 1}`)))) throw new SeoWorkerError("IMAGE_VIEW_REQUIRED");
        }
        if (!["IN_PROGRESS", "NEEDS_CHANGES"].includes(job.status)) throw new SeoWorkerError("JOB_NOT_EDITABLE");
        if (digest(job.checkpoints) !== digest(input.expectedCheckpoints)) throw new SeoWorkerError("VERSION_CONFLICT");
        const stages = ["analysis", "research", "keywords", "submission"] as const;
        const stageIndex = stages.indexOf(input.stage);
        if (stageIndex < 0 || stages.slice(0, stageIndex).some(stage => !job.checkpoints[stage])) throw new SeoWorkerError("CHECKPOINT_REQUIRED");
        if (job.status === "NEEDS_CHANGES" && Number(worker.repair_count) >= WORKER_DEFAULTS.maxRepairs) throw new SeoWorkerError("REPAIR_LIMIT_REACHED");
        const checkpoints = { ...job.checkpoints, [input.stage]: input.payload };
        for (const later of stages.slice(stageIndex + 1)) delete checkpoints[later];
        const status = input.stage === "submission" ? "VALIDATING" : "IN_PROGRESS";
        await sql.query("UPDATE gpt_jobs SET status=$2,payload=$3 WHERE id=$1", [job.id, status, JSON.stringify({ ...job, status, checkpoints, error: undefined, updatedAt: this.now() })]);
        await sql.query(`UPDATE seo_worker_jobs SET state=$2,last_progress_at=$3,updated_at=$3,
          repair_count=repair_count+$4 WHERE job_id=$1`, [job.id, input.stage === "submission" ? "SUBMITTING" : "PROCESSING", this.now(), job.status === "NEEDS_CHANGES" ? 1 : 0]);
        return { jobId: job.id, status };
      });
    });
  }

  async checkpointReceipt(token: string, lease: WorkerLease, requestId: string, payload: unknown): Promise<unknown | null> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, lease.sessionId);
      const row = (await sql.query("SELECT digest,response FROM seo_worker_requests WHERE scope=$1 AND request_id=$2", [`${principal.tokenId}:${lease.jobId}:${lease.leaseVersion}:checkpoint`, requestId])).rows[0];
      if (!row) return null;
      if (row.digest !== digest(payload)) throw new SeoWorkerError("IDEMPOTENCY_CONFLICT");
      await this.recordSubmissionReplay(sql, `${principal.tokenId}:checkpoint`, payload);
      return row.response;
    });
  }

  async recordImage(token: string, lease: WorkerLease, imageId: string, sha256: string): Promise<void> {
    await this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.assertLease(sql, principal, lease);
      await sql.query("INSERT INTO seo_worker_image_receipts(job_id,lease_version,image_id,sha256,viewed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(job_id,lease_version,image_id) DO UPDATE SET sha256=excluded.sha256,viewed_at=excluded.viewed_at", [lease.jobId, lease.leaseVersion, imageId, sha256, this.now()]);
    });
  }

  async jobResult(token: string, jobId: string): Promise<{ jobId: string; status: string; error?: string }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      const row = (await sql.query(`SELECT j.status,j.payload FROM gpt_jobs j JOIN seo_worker_jobs w ON w.job_id=j.id
        WHERE w.job_id=$1 AND w.store_id=$2 AND w.worker_id=$3`, [jobId, principal.storeId, principal.workerId])).rows[0];
      if (!row) throw new SeoWorkerError("JOB_NOT_FOUND");
      const job = JSON.parse(String(row.payload)) as GptSeoJob;
      return { jobId, status: String(row.status), ...(job.error ? { error: "VALIDATION_FAILED: revise grounded SEO/AEO output or request operator review." } : {}) };
    });
  }

  private async session(sql: WorkerSql, principal: WorkerPrincipal, sessionId: string): Promise<void> {
    const row = (await sql.query(`SELECT id FROM seo_worker_sessions WHERE id=$1 AND token_id=$2
      AND store_id=$3 AND worker_id=$4 AND active FOR UPDATE`, [sessionId, principal.tokenId, principal.storeId, principal.workerId])).rows[0];
    if (!row) throw new SeoWorkerError("STALE_SESSION");
    await sql.query("UPDATE seo_worker_sessions SET last_seen_at=$2 WHERE id=$1", [sessionId, this.now()]);
  }

  private async idempotent<T>(sql: WorkerSql, scope: string, requestId: string, payload: unknown, operation: () => Promise<T>): Promise<T> {
    requireLabel(requestId);
    const fingerprint = digest(payload);
    const previous = (await sql.query("SELECT digest,response FROM seo_worker_requests WHERE scope=$1 AND request_id=$2", [scope, requestId])).rows[0];
    if (previous) {
      if (previous.digest !== fingerprint) throw new SeoWorkerError("IDEMPOTENCY_CONFLICT");
      await this.recordSubmissionReplay(sql, scope, payload);
      return previous.response as T;
    }
    const output = await operation();
    await sql.query("INSERT INTO seo_worker_requests(scope,request_id,digest,response) VALUES ($1,$2,$3,$4::jsonb)",
      [scope, requestId, fingerprint, JSON.stringify(output)]);
    return output;
  }

  private async recordSubmissionReplay(sql: WorkerSql, scope: string, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object" || !("stage" in payload) || payload.stage !== "submission") return;
    await sql.query(`INSERT INTO seo_worker_metric_events(id,store_id,kind,occurred_at)
      SELECT $1,store_id,'DUPLICATE_SUBMISSION',$2 FROM seo_worker_tokens WHERE id=$3`, [randomUUID(), this.now(), scope.split(":")[0]]);
  }

  async register(token: string, requestId: string): Promise<{ sessionId: string }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      return this.idempotent(sql, `${principal.tokenId}:register`, requestId, principal.storeIds.length > 1 ? { storeId: principal.storeId } : {}, async () => {
        const existing = (await sql.query("SELECT id FROM seo_worker_sessions WHERE store_id=$1 AND worker_id=$2 AND active FOR UPDATE", [principal.storeId, principal.workerId])).rows[0];
        if (existing) {
          for (const lease of (await sql.query("SELECT * FROM seo_worker_jobs WHERE session_id=$1 AND lease_id IS NOT NULL FOR UPDATE", [existing.id])).rows) {
            await this.endLease(sql, lease, "SESSION_REPLACED", true);
          }
          await sql.query("UPDATE seo_worker_sessions SET active=false WHERE id=$1", [existing.id]);
          await sql.query("UPDATE seo_worker_runs SET state='PARTIAL',stop_reason='SESSION_REPLACED',updated_at=$2 WHERE session_id=$1 AND state='RUNNING'", [existing.id, this.now()]);
        }
        const sessionId = randomUUID();
        await sql.query(`INSERT INTO seo_worker_sessions(id,token_id,store_id,worker_id,active,created_at,last_seen_at)
          VALUES ($1,$2,$3,$4,true,$5,$5)`, [sessionId, principal.tokenId, principal.storeId, principal.workerId, this.now()]);
        return { sessionId };
      });
    });
  }

  async startRun(token: string, sessionId: string, target: number, requestId: string): Promise<WorkerRun> {
    validateTargetCount(target);
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, sessionId);
      return this.idempotent(sql, `${sessionId}:start`, requestId, { target }, async () => {
        const active = (await sql.query("SELECT id FROM seo_worker_runs WHERE store_id=$1 AND worker_id=$2 AND state='RUNNING'", [principal.storeId, principal.workerId])).rows[0];
        if (active) throw new SeoWorkerError("RUN_ALREADY_ACTIVE");
        const rows = await sql.query(`INSERT INTO seo_worker_runs(id,store_id,worker_id,session_id,target,state,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,'RUNNING',$6,$6) RETURNING *`, [randomUUID(), principal.storeId, principal.workerId, sessionId, target, this.now()]);
        return runOutput(rows.rows[0]);
      });
    });
  }

  private async getRun(sql: WorkerSql, principal: WorkerPrincipal, runId: string): Promise<Record<string, unknown>> {
    const run = (await sql.query("SELECT * FROM seo_worker_runs WHERE id=$1 AND store_id=$2 AND worker_id=$3 FOR UPDATE", [runId, principal.storeId, principal.workerId])).rows[0];
    if (!run) throw new SeoWorkerError("RUN_NOT_FOUND");
    return run;
  }

  async runStatus(token: string, runId: string): Promise<WorkerRun> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      // Reconcile only after authorization; never report accepted submissions as success.
      await this.reconcileInTransaction(sql, principal.storeId);
      return runOutput(await this.getRun(sql, principal, runId));
    });
  }

  async finishRun(token: string, sessionId: string, runId: string, requestId: string): Promise<WorkerRun> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, sessionId);
      return this.idempotent(sql, `${sessionId}:finish`, requestId, { runId }, async () => {
        await this.reconcileInTransaction(sql, principal.storeId);
        const run = await this.getRun(sql, principal, runId);
        if (run.session_id !== sessionId) throw new SeoWorkerError("STALE_SESSION");
        if (run.state === "COMPLETED") return runOutput(run);
        for (const row of (await sql.query("SELECT * FROM seo_worker_jobs WHERE run_id=$1 AND lease_id IS NOT NULL FOR UPDATE", [runId])).rows) await this.endLease(sql, row, "RUN_STOPPED", true);
        const updated = (await sql.query("UPDATE seo_worker_runs SET state='PARTIAL',stop_reason='OPERATOR_STOPPED',updated_at=$2 WHERE id=$1 RETURNING *", [runId, this.now()])).rows[0];
        return runOutput(updated);
      });
    });
  }

  async cutoverReport(storeId: string): Promise<{
    activeBatches: string[]; unfinishedJobs: string[]; duplicateProducts: { productKey: string; jobIds: string[] }[];
  }> {
    requireLabel(storeId);
    return this.database.transaction(async sql => {
      const batches = (await sql.query("SELECT id FROM gpt_batches WHERE store_id=$1 AND provider='codex_mcp' AND active=1 AND expires_at>$2", [storeId, this.now()])).rows;
      const jobs = (await sql.query(`SELECT j.payload FROM gpt_jobs j LEFT JOIN gpt_sync s ON s.job_id=j.id
        LEFT JOIN gpt_review_state r ON r.job_id=j.id WHERE j.store_id=$1 AND j.status!='CANCELLED'
        AND COALESCE(s.status,'')!='SYNCED' AND COALESCE(r.payload::jsonb->>'reviewDecision','')!='rejected'`, [storeId])).rows.map(row => JSON.parse(String(row.payload)) as GptSeoJob);
      const products = new Map<string, string[]>();
      for (const job of jobs) {
        const key = getWorkerProductKey(job.execution);
        products.set(key, [...products.get(key) ?? [], job.id]);
      }
      return { activeBatches: batches.map(row => String(row.id)),
        unfinishedJobs: jobs.filter(job => job.settings.provider === "codex_mcp" && ["IN_PROGRESS", "VALIDATING", "NEEDS_CHANGES"].includes(job.status)).map(job => job.id),
        duplicateProducts: [...products].filter(([, ids]) => ids.length > 1).map(([productKey, jobIds]) => ({ productKey, jobIds })) };
    });
  }

  async disableClaims(storeId: string): Promise<void> {
    await this.database.transaction(async sql => { await sql.query("UPDATE seo_worker_stores SET enabled=false WHERE store_id=$1", [storeId]); });
  }

  async resumeRun(token: string, sessionId: string, runId: string, requestId?: string): Promise<WorkerRun> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, sessionId);
      const resume = async (): Promise<WorkerRun> => {
      const run = await this.getRun(sql, principal, runId);
      if (run.state === "COMPLETED") return runOutput(run);
      const other = (await sql.query("SELECT id FROM seo_worker_runs WHERE store_id=$1 AND worker_id=$2 AND state='RUNNING' AND id!=$3", [principal.storeId, principal.workerId, runId])).rows[0];
      if (other) throw new SeoWorkerError("RUN_ALREADY_ACTIVE");
      for (const lease of (await sql.query("SELECT * FROM seo_worker_jobs WHERE run_id=$1 AND session_id!=$2 AND lease_id IS NOT NULL FOR UPDATE", [runId, sessionId])).rows) {
        await this.endLease(sql, lease, "SESSION_REPLACED", true);
      }
      const updated = await sql.query("UPDATE seo_worker_runs SET state='RUNNING',stop_reason=NULL,session_id=$2,updated_at=$3 WHERE id=$1 RETURNING *", [runId, sessionId, this.now()]);
      return runOutput(updated.rows[0]);
      };
      return requestId ? this.idempotent(sql, `${sessionId}:resume`, requestId, { runId }, resume) : resume();
    });
  }

  /** Called only after operator-controlled cutover has drained legacy leases. */
  async enableStore(storeId: string): Promise<{ imported: number }> {
    requireLabel(storeId);
    return this.database.transaction(async sql => {
      const converted = (await sql.query("SELECT store_id FROM seo_worker_stores WHERE store_id=$1 FOR UPDATE", [storeId])).rows[0];
      const live = (await sql.query("SELECT id FROM gpt_batches WHERE store_id=$1 AND provider='codex_mcp' AND active=1 AND expires_at>$2", [storeId, this.now()])).rows;
      if (!converted && live.length) throw new SeoWorkerError("LEGACY_BATCH_ACTIVE");
      const active = (await sql.query(`SELECT payload FROM gpt_jobs WHERE store_id=$1 AND provider='codex_mcp'
        AND status IN ('IN_PROGRESS','VALIDATING') FOR UPDATE`, [storeId])).rows;
      if (!converted && active.length) throw new SeoWorkerError("LEGACY_JOB_NOT_DRAINED");
      for (const row of active) migrateLegacyWorkerJob(JSON.parse(String(row.payload)) as GptSeoJob);
      const rows = (await sql.query(`SELECT j.payload,w.job_id AS worker_job_id FROM gpt_jobs j LEFT JOIN gpt_sync s ON s.job_id=j.id
        LEFT JOIN gpt_review_state r ON r.job_id=j.id
        LEFT JOIN seo_worker_jobs w ON w.job_id=j.id
        WHERE j.store_id=$1 AND j.status IN ('PENDING','WAITING_INPUT','NEEDS_CHANGES') AND COALESCE(s.status,'')!='SYNCED'
        AND COALESCE(r.payload::jsonb->>'reviewDecision','')!='rejected'`, [storeId])).rows;
      const identities = new Set<string>();
      const migrations = rows.map(row => ({ ...migrateLegacyWorkerJob(JSON.parse(String(row.payload)) as GptSeoJob), hasWorker: row.worker_job_id !== null }));
      for (const { job } of migrations) {
        const key = getWorkerProductKey(job.execution);
        if (identities.has(key)) throw new SeoWorkerError("DUPLICATE_ACTIVE_PRODUCT");
        identities.add(key);
      }
      let imported = 0;
      for (const migration of migrations) {
        const { job } = migration;
        if (migration.migrated) {
          await sql.query("UPDATE gpt_jobs SET status='PENDING',payload=$2 WHERE id=$1", [job.id, JSON.stringify(job)]);
          await sql.query("INSERT INTO gpt_audit(store_id,event,created_at) VALUES ($1,$2,$3)", [storeId, `JOB_INPUT_V2_MIGRATED:${job.id}`, this.now()]);
          imported++;
        }
        await sql.query(`INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at)
          VALUES ($1,$2,$3,'READY',$4) ON CONFLICT(job_id) DO NOTHING`, [job.id, storeId, getWorkerProductKey(job.execution), this.now()]);
        if (!migration.migrated && !migration.hasWorker) imported++;
      }
      await sql.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ($1,true) ON CONFLICT(store_id) DO UPDATE SET enabled=true", [storeId]);
      return { imported };
    });
  }

  async claim(token: string, sessionId: string, runId: string, requestId: string): Promise<{ lease: WorkerLease | null; stopReason?: string }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, sessionId);
      const enabled = (await sql.query("SELECT enabled FROM seo_worker_stores WHERE store_id=$1", [principal.storeId])).rows[0];
      if (!enabled?.enabled) throw new SeoWorkerError("WORKER_STORE_DISABLED");
      await this.recoverInTransaction(sql);
      const run = await this.getRun(sql, principal, runId);
      if (run.session_id !== sessionId) throw new SeoWorkerError("STALE_SESSION");
      return this.idempotent(sql, `${sessionId}:claim`, requestId, { runId }, async () => {
        if (run.state !== "RUNNING") return { lease: null, stopReason: String(run.stop_reason || "RUN_NOT_RUNNING") };
        if (principal.expiresAt - this.now() < WORKER_DEFAULTS.leaseMs) throw new SeoWorkerError("TOKEN_EXPIRING_SOON");
        const existing = (await sql.query("SELECT * FROM seo_worker_jobs WHERE store_id=$1 AND worker_id=$2 AND lease_id IS NOT NULL", [principal.storeId, principal.workerId])).rows[0];
        if (existing) throw new SeoWorkerError("LEASE_ALREADY_ACTIVE");
        const candidate = (await sql.query(`SELECT w.* FROM seo_worker_jobs w JOIN gpt_jobs j ON j.id=w.job_id
          WHERE w.store_id=$1 AND w.state='READY' AND j.status='PENDING' AND j.provider='codex_mcp'
          ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF w,j SKIP LOCKED`, [principal.storeId])).rows[0];
        if (!candidate) {
          const counts = (await sql.query(`SELECT w.state,count(*) AS count FROM seo_worker_jobs w JOIN gpt_jobs j ON j.id=w.job_id
            WHERE w.store_id=$1 AND j.provider='codex_mcp' GROUP BY w.state`, [principal.storeId])).rows;
          const retrying = counts.some(row => row.state === "RETRY_WAIT");
          const busy = counts.some(row => ["LEASED", "PROCESSING", "SUBMITTING"].includes(String(row.state)));
          const stopReason = busy ? "JOBS_BUSY" : retrying ? "RETRY_PENDING" : "QUEUE_EXHAUSTED";
          await sql.query("UPDATE seo_worker_runs SET state='PARTIAL',stop_reason=$2,updated_at=$3 WHERE id=$1", [runId, stopReason, this.now()]);
          return { lease: null, stopReason };
        }
        const leaseId = randomUUID();
        const updated = (await sql.query(`UPDATE seo_worker_jobs SET state='LEASED',attempt_count=attempt_count+1,
          repair_count=0,lease_version=lease_version+1,lease_id=$2,session_id=$3,run_id=$4,token_id=$5,
          expires_at=$6,last_progress_at=$7,updated_at=$7,retry_at=NULL,last_error_code=NULL,worker_id=$8 WHERE job_id=$1 RETURNING *`,
        [candidate.job_id, leaseId, sessionId, runId, principal.tokenId, Math.min(this.now() + WORKER_DEFAULTS.leaseMs, principal.expiresAt), this.now(), principal.workerId])).rows[0];
        await sql.query(`INSERT INTO seo_worker_attempts(id,job_id,session_id,run_id,lease_version,started_at)
          VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), candidate.job_id, sessionId, runId, updated.lease_version, this.now()]);
        await this.projectStatus(sql, String(candidate.job_id), "IN_PROGRESS");
        return { lease: leaseOutput(updated) };
      });
    });
  }

  private async assertLease(sql: WorkerSql, principal: WorkerPrincipal, lease: WorkerLease): Promise<Record<string, unknown>> {
    await this.session(sql, principal, lease.sessionId);
    const row = (await sql.query(`SELECT * FROM seo_worker_jobs WHERE job_id=$1 AND store_id=$2
      AND session_id=$3 AND run_id=$4 AND lease_id=$5 AND lease_version=$6 AND token_id=$7 FOR UPDATE`,
    [lease.jobId, principal.storeId, lease.sessionId, lease.runId, lease.leaseId, lease.leaseVersion, principal.tokenId])).rows[0];
    if (!row || Number(row.expires_at) <= this.now() || Number(row.last_progress_at) + WORKER_DEFAULTS.idleMs <= this.now()) throw new SeoWorkerError("STALE_LEASE");
    return row;
  }

  async heartbeat(token: string, lease: WorkerLease, requestId?: string): Promise<WorkerLease> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.assertLease(sql, principal, lease);
      const renew = async (): Promise<WorkerLease> => {
      const updated = (await sql.query("UPDATE seo_worker_jobs SET expires_at=LEAST($2,last_progress_at+$3),updated_at=$4 WHERE job_id=$1 RETURNING *",
        [lease.jobId, Math.min(this.now() + WORKER_DEFAULTS.leaseMs, principal.expiresAt), WORKER_DEFAULTS.idleMs, this.now()])).rows[0];
      return leaseOutput(updated);
      };
      return requestId ? this.idempotent(sql, `${principal.tokenId}:heartbeat`, requestId, { lease }, renew) : renew();
    });
  }

  /** The callback is trusted server-side validation, never arbitrary MCP-provided code. */
  async withLease<T>(token: string, lease: WorkerLease, operation: (sql: WorkerSql, principal: WorkerPrincipal) => Promise<T>): Promise<T> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.assertLease(sql, principal, lease);
      const output = await operation(sql, principal);
      await sql.query("UPDATE seo_worker_jobs SET last_progress_at=$2,updated_at=$2 WHERE job_id=$1", [lease.jobId, this.now()]);
      return output;
    });
  }

  private async projectStatus(sql: WorkerSql, jobId: string, status: string): Promise<void> {
    await sql.query(`UPDATE gpt_jobs SET status=$2,payload=(payload::jsonb || jsonb_build_object('status',$2::text,'updatedAt',$3::bigint))::text WHERE id=$1`, [jobId, status, this.now()]);
  }

  private async endLease(sql: WorkerSql, row: Record<string, unknown>, code: string, retryable: boolean): Promise<void> {
    if (await this.settleReview(sql, row)) return;
    // The finalizer has committed a draft. Only the delivery outbox may retry now;
    // generating another draft here would duplicate work after a delivery timeout.
    const accepted = (await sql.query("SELECT id FROM gpt_jobs WHERE id=$1 AND status='REVIEW_READY'", [row.job_id])).rows[0];
    if (accepted) return;
    const state = retryable ? Number(row.attempt_count) >= WORKER_DEFAULTS.maxAttempts ? "FAILED_FINAL" : "RETRY_WAIT" : code === "PRODUCT_DELETED" ? "CANCELLED" : "BLOCKED";
    await sql.query("UPDATE seo_worker_attempts SET ended_at=$3,result=$4 WHERE job_id=$1 AND lease_version=$2 AND ended_at IS NULL", [row.job_id, row.lease_version, this.now(), code]);
    await sql.query(`UPDATE seo_worker_jobs SET state=$2,lease_id=NULL,expires_at=NULL,last_error_code=$3,
      retry_at=$4,updated_at=$5,pipeline_active=($2!='CANCELLED') WHERE job_id=$1`,
    [row.job_id, state, code, state === "RETRY_WAIT" ? this.now() + getRetryDelay(Number(row.attempt_count), this.jitter()) : null, this.now()]);
    await this.projectStatus(sql, String(row.job_id), state === "CANCELLED" ? "CANCELLED" : state === "BLOCKED" ? "WAITING_INPUT" : "FAILED");
    // A reclaimed attempt must never share a finalizer or keyword/submission checkpoint.
    await sql.query(`UPDATE gpt_jobs SET batch_id=NULL,payload=(payload::jsonb - 'finalizerToken' - 'finalizerUntil' - 'nextAttemptAt'
      || jsonb_build_object('checkpoints',COALESCE(payload::jsonb->'checkpoints','{}'::jsonb)-'submission'-'keywords'))::text WHERE id=$1`, [row.job_id]);
  }

  /** Completion is based on the existing durable Review delivery, not a client assertion. */
  private async settleReview(sql: WorkerSql, row: Record<string, unknown>): Promise<boolean> {
    if (!row.run_id) return false;
    // Review reads the finalized result directly from gpt_jobs. Older finalizers
    // persisted that result but left its delivery receipt pending forever.
    // Repair only matching, durable drafts; status alone is not proof of delivery.
    await sql.query(`UPDATE gpt_deliveries d SET delivered=1 FROM gpt_jobs j
      WHERE d.job_id=j.id AND j.id=$1 AND j.status='REVIEW_READY' AND d.delivered=0
      AND jsonb_typeof(j.payload::jsonb->'result'->'output')='object'
      AND j.payload::jsonb->'result'=d.payload::jsonb`, [row.job_id]);
    const delivered = (await sql.query(`SELECT j.id,s.status AS sync_status,r.payload::jsonb->>'reviewDecision' AS decision
      FROM gpt_jobs j JOIN gpt_deliveries d ON d.job_id=j.id LEFT JOIN gpt_sync s ON s.job_id=j.id
      LEFT JOIN gpt_review_state r ON r.job_id=j.id
      WHERE j.id=$1 AND j.status='REVIEW_READY' AND d.delivered=1`, [row.job_id])).rows[0];
    if (!delivered) return false;
    const inserted = (await sql.query(`INSERT INTO seo_worker_successes(job_id,run_id,completed_at) VALUES ($1,$2,$3)
      ON CONFLICT(job_id) DO NOTHING RETURNING job_id`, [row.job_id, row.run_id, this.now()])).rows[0];
    if (inserted) {
      await sql.query(`UPDATE seo_worker_runs SET successful=successful+1,updated_at=$2,
        state=CASE WHEN successful+1=target THEN 'COMPLETED' ELSE state END,
        stop_reason=CASE WHEN successful+1=target THEN 'TARGET_REACHED' ELSE stop_reason END WHERE id=$1`, [row.run_id, this.now()]);
    }
    await sql.query("UPDATE seo_worker_attempts SET ended_at=$3,result='SUCCESS' WHERE job_id=$1 AND lease_version=$2 AND ended_at IS NULL", [row.job_id, row.lease_version, this.now()]);
    const closed = delivered.sync_status === "SYNCED" || delivered.decision === "rejected";
    await sql.query("UPDATE seo_worker_jobs SET state=$3,pipeline_active=$4,lease_id=NULL,expires_at=NULL,updated_at=$2 WHERE job_id=$1", [row.job_id, this.now(), closed ? "CLOSED" : "READY_FOR_REVIEW", !closed]);
    return true;
  }

  async reconcileReviews(): Promise<void> {
    await this.database.transaction(sql => this.reconcileInTransaction(sql));
  }

  private async reconcileInTransaction(sql: WorkerSql, storeId?: string): Promise<void> {
    const rows = storeId
      ? await sql.query("SELECT * FROM seo_worker_jobs WHERE lease_id IS NOT NULL AND store_id=$1 FOR UPDATE", [storeId])
      : await sql.query("SELECT * FROM seo_worker_jobs WHERE lease_id IS NOT NULL FOR UPDATE");
    for (const row of rows.rows) await this.settleReview(sql, row);
  }

  async release(token: string, lease: WorkerLease, input: { code: string; retryable: boolean; requestId: string }): Promise<{ released: true }> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.code)) throw new SeoWorkerError("INVALID_ERROR_CODE");
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, lease.sessionId);
      return this.idempotent(sql, `${principal.tokenId}:release`, input.requestId, { lease, code: input.code, retryable: input.retryable }, async () => {
        const row = await this.assertLease(sql, principal, lease);
        await this.endLease(sql, row, input.code, input.retryable);
        return { released: true as const };
      });
    });
  }

  async revoke(storeId: string, tokenId: string): Promise<void> {
    await this.database.transaction(async sql => {
      const token = (await sql.query("UPDATE seo_worker_tokens SET revoked_at=$3 WHERE id=$1 AND (store_id=$2 OR store_ids @> jsonb_build_array($2::text)) RETURNING id", [tokenId, storeId, this.now()])).rows[0];
      if (!token) throw new SeoWorkerError("TOKEN_NOT_FOUND");
      for (const row of (await sql.query("SELECT * FROM seo_worker_jobs WHERE token_id=$1 AND lease_id IS NOT NULL FOR UPDATE", [tokenId])).rows) await this.endLease(sql, row, "TOKEN_REVOKED", true);
      await sql.query("UPDATE seo_worker_runs SET state='PARTIAL',stop_reason='TOKEN_REVOKED',updated_at=$2 WHERE state='RUNNING' AND session_id IN (SELECT id FROM seo_worker_sessions WHERE token_id=$1)", [tokenId, this.now()]);
      await sql.query("UPDATE seo_worker_sessions SET active=false WHERE token_id=$1", [tokenId]);
    });
  }

  private async recoverInTransaction(sql: WorkerSql): Promise<number> {
    await this.reconcileInTransaction(sql);
    const rows = (await sql.query(`SELECT w.* FROM seo_worker_jobs w JOIN seo_worker_tokens t ON t.id=w.token_id
      WHERE w.lease_id IS NOT NULL AND (w.expires_at<=$1 OR w.last_progress_at<=$2 OR t.expires_at<=$1 OR t.revoked_at IS NOT NULL)
      FOR UPDATE OF w`, [this.now(), this.now() - WORKER_DEFAULTS.idleMs])).rows;
    for (const row of rows) await this.endLease(sql, row, "LEASE_EXPIRED", true);
    const ready = (await sql.query("UPDATE seo_worker_jobs SET state='READY',retry_at=NULL,updated_at=$1 WHERE state='RETRY_WAIT' AND retry_at<=$1 RETURNING job_id", [this.now()])).rows;
    for (const row of ready) await this.projectStatus(sql, String(row.job_id), "PENDING");
    return rows.length;
  }

  async recover(): Promise<number> { return this.database.transaction(sql => this.recoverInTransaction(sql)); }
}
