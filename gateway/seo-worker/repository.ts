import { createHash, randomBytes, randomUUID } from "node:crypto";

import { canonicalizeJson } from "../canonical-json";
import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";

import type { WorkerDatabase, WorkerSql } from "./database";
import type { WorkerLease, WorkerPrincipal, WorkerRun } from "./protocol";
import { getRetryDelay, getWorkerProductKey, SeoWorkerError, validateTargetCount, WORKER_DEFAULTS } from "./protocol";

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
  constructor(private readonly database: WorkerDatabase, private readonly now: () => number = Date.now,
    private readonly jitter: () => number = Math.random) {}

  async issueToken(input: { storeId: string; workerId: string; createdBy: string }): Promise<{ token: string; tokenId: string; expiresAt: number }> {
    for (const value of Object.values(input)) requireLabel(value);
    const token = `ffp_worker_${randomBytes(32).toString("base64url")}`;
    const tokenId = randomUUID();
    const expiresAt = this.now() + WORKER_DEFAULTS.tokenMs;
    await this.database.transaction(async sql => {
      await sql.query(`INSERT INTO seo_worker_tokens(id,store_id,worker_id,token_hash,created_by,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tokenId, input.storeId, input.workerId, digest(token), input.createdBy, this.now(), expiresAt]);
    });
    return { token, tokenId, expiresAt };
  }

  private async authenticate(sql: WorkerSql, token: string): Promise<WorkerPrincipal> {
    const row = (await sql.query("SELECT * FROM seo_worker_tokens WHERE token_hash=$1 FOR UPDATE", [digest(token)])).rows[0];
    if (!row) throw new SeoWorkerError("INVALID_TOKEN");
    if (row.revoked_at !== null) throw new SeoWorkerError("TOKEN_REVOKED");
    if (Number(row.expires_at) <= this.now()) throw new SeoWorkerError("TOKEN_EXPIRED");
    await sql.query("UPDATE seo_worker_tokens SET last_used_at=$2 WHERE id=$1", [row.id, this.now()]);
    return { tokenId: String(row.id), storeId: String(row.store_id), workerId: String(row.worker_id), expiresAt: Number(row.expires_at) };
  }

  async identify(token: string): Promise<WorkerPrincipal> {
    return this.database.transaction(sql => this.authenticate(sql, token));
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
      return previous.response as T;
    }
    const output = await operation();
    await sql.query("INSERT INTO seo_worker_requests(scope,request_id,digest,response) VALUES ($1,$2,$3,$4::jsonb)",
      [scope, requestId, fingerprint, JSON.stringify(output)]);
    return output;
  }

  async register(token: string, requestId: string): Promise<{ sessionId: string }> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      return this.idempotent(sql, `${principal.tokenId}:register`, requestId, {}, async () => {
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
        const key = getWorkerProductKey(job);
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

  async resumeRun(token: string, sessionId: string, runId: string): Promise<WorkerRun> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.session(sql, principal, sessionId);
      const run = await this.getRun(sql, principal, runId);
      if (run.state === "COMPLETED") return runOutput(run);
      const other = (await sql.query("SELECT id FROM seo_worker_runs WHERE store_id=$1 AND worker_id=$2 AND state='RUNNING' AND id!=$3", [principal.storeId, principal.workerId, runId])).rows[0];
      if (other) throw new SeoWorkerError("RUN_ALREADY_ACTIVE");
      for (const lease of (await sql.query("SELECT * FROM seo_worker_jobs WHERE run_id=$1 AND session_id!=$2 AND lease_id IS NOT NULL FOR UPDATE", [runId, sessionId])).rows) {
        await this.endLease(sql, lease, "SESSION_REPLACED", true);
      }
      const updated = await sql.query("UPDATE seo_worker_runs SET state='RUNNING',stop_reason=NULL,session_id=$2,updated_at=$3 WHERE id=$1 RETURNING *", [runId, sessionId, this.now()]);
      return runOutput(updated.rows[0]);
    });
  }

  /** Called only after operator-controlled cutover has drained legacy leases. */
  async enableStore(storeId: string): Promise<{ imported: number }> {
    requireLabel(storeId);
    return this.database.transaction(async sql => {
      const converted = (await sql.query("SELECT store_id FROM seo_worker_stores WHERE store_id=$1 FOR UPDATE", [storeId])).rows[0];
      if (converted) {
        await sql.query("UPDATE seo_worker_stores SET enabled=true WHERE store_id=$1", [storeId]);
        return { imported: 0 };
      }
      const live = (await sql.query("SELECT id FROM gpt_batches WHERE store_id=$1 AND provider='codex_mcp' AND active=1 AND expires_at>$2", [storeId, this.now()])).rows;
      if (live.length) throw new SeoWorkerError("LEGACY_BATCH_ACTIVE");
      const rows = (await sql.query(`SELECT j.payload FROM gpt_jobs j LEFT JOIN gpt_sync s ON s.job_id=j.id
        LEFT JOIN gpt_review_state r ON r.job_id=j.id
        WHERE j.store_id=$1 AND j.status!='CANCELLED' AND COALESCE(s.status,'')!='SYNCED'
        AND COALESCE(r.payload::jsonb->>'reviewDecision','')!='rejected'`, [storeId])).rows;
      const identities = new Set<string>();
      const jobs = rows.map(row => JSON.parse(String(row.payload)) as GptSeoJob);
      for (const job of jobs) {
        const key = getWorkerProductKey(job);
        if (identities.has(key)) throw new SeoWorkerError("DUPLICATE_ACTIVE_PRODUCT");
        identities.add(key);
        if (job.settings.provider === "codex_mcp" && ["IN_PROGRESS", "VALIDATING", "NEEDS_CHANGES"].includes(job.status)) {
          throw new SeoWorkerError("LEGACY_JOB_NOT_DRAINED");
        }
      }
      for (const job of jobs) {
        const state = job.status === "REVIEW_READY" ? "READY_FOR_REVIEW" : job.status === "PENDING" ? "READY" : "BLOCKED";
        await sql.query(`INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO NOTHING`, [job.id, storeId, getWorkerProductKey(job), state, this.now()]);
      }
      await sql.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ($1,true) ON CONFLICT(store_id) DO UPDATE SET enabled=true", [storeId]);
      return { imported: jobs.length };
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

  async heartbeat(token: string, lease: WorkerLease): Promise<WorkerLease> {
    return this.database.transaction(async sql => {
      const principal = await this.authenticate(sql, token);
      await this.assertLease(sql, principal, lease);
      const updated = (await sql.query("UPDATE seo_worker_jobs SET expires_at=LEAST($2,last_progress_at+$3),updated_at=$4 WHERE job_id=$1 RETURNING *",
        [lease.jobId, Math.min(this.now() + WORKER_DEFAULTS.leaseMs, principal.expiresAt), WORKER_DEFAULTS.idleMs, this.now()])).rows[0];
      return leaseOutput(updated);
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
      const token = (await sql.query("UPDATE seo_worker_tokens SET revoked_at=$3 WHERE id=$1 AND store_id=$2 RETURNING id", [tokenId, storeId, this.now()])).rows[0];
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
