import { createHash } from "node:crypto";
import { canonicalizeJson } from "../canonical-json";
import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { WorkerDatabase, WorkerSql } from "./database";
import { getWorkerProductKey, SeoWorkerError } from "./protocol";

export class SeoCutoverRepository {
  constructor(private readonly database: WorkerDatabase, private readonly enable: (storeId: string) => Promise<{ imported: number }>, private readonly now: () => number = Date.now, private readonly recoverExpired: (storeId: string) => Promise<void> = async () => {}) {}

  private async report(sql: WorkerSql, storeId: string) {
    const jobs = (await sql.query(`SELECT j.*,r.payload AS review,s.status AS sync,d.delivered FROM gpt_jobs j
      LEFT JOIN gpt_review_state r ON r.job_id=j.id LEFT JOIN gpt_sync s ON s.job_id=j.id
      LEFT JOIN gpt_deliveries d ON d.job_id=j.id WHERE j.store_id=$1 ORDER BY j.id`, [storeId])).rows;
    const batches = (await sql.query("SELECT * FROM gpt_batches WHERE store_id=$1 ORDER BY id", [storeId])).rows;
    const mode = (await sql.query("SELECT * FROM seo_worker_stores WHERE store_id=$1", [storeId])).rows;
    const draining = (await sql.query("SELECT store_id FROM seo_worker_cutovers WHERE store_id=$1 AND draining=true", [storeId])).rows.length > 0;
    const identities = new Map<string, string[]>();
    const blocked: { jobId: string; code: string }[] = [];
    for (const row of jobs) {
      if (row.status === "CANCELLED" || row.sync === "SYNCED" || (row.review && JSON.parse(String(row.review)).reviewDecision === "rejected")) continue;
      const job = JSON.parse(String(row.payload)) as GptSeoJob;
      try { const key = getWorkerProductKey(job); identities.set(key, [...(identities.get(key) ?? []), String(row.id)]); }
      catch { blocked.push({ jobId: String(row.id), code: "INVALID_SOURCE" }); }
      if (row.provider === "codex_mcp" && ["IN_PROGRESS", "VALIDATING", "NEEDS_CHANGES"].includes(String(row.status))) blocked.push({ jobId: String(row.id), code: "LEGACY_JOB_NOT_DRAINED" });
      if (["SYNCING", "UNKNOWN"].includes(String(row.sync))) blocked.push({ jobId: String(row.id), code: "SYNC_UNRESOLVED" });
    }
    const audit = (await sql.query("SELECT count(*) AS count,max(id) AS last FROM gpt_audit WHERE store_id=$1", [storeId])).rows;
    const fingerprint = createHash("sha256").update(canonicalizeJson({ storeId, jobs, batches, mode, draining, audit })).digest("hex");
    return { storeId, fingerprint, draining, converted: mode.length > 0, totalJobs: jobs.length,
      activeBatches: batches.filter(row => row.provider === "codex_mcp" && Number(row.active) === 1 && Number(row.expires_at) > this.now()).map(row => String(row.id)),
      duplicates: [...identities].filter(([, ids]) => ids.length > 1).map(([productKey, jobIds]) => ({ productKey, jobIds })), blocked };
  }
  async inspect(storeId: string): Promise<Awaited<ReturnType<SeoCutoverRepository["report"]>>> {
    return this.database.transaction(sql => this.report(sql, storeId));
  }
  async drain(storeId: string, operator: string): Promise<void> {
    await this.database.transaction(async sql => {
      await sql.query("INSERT INTO seo_worker_cutovers(store_id,draining) VALUES ($1,true) ON CONFLICT(store_id) DO UPDATE SET draining=true", [storeId]);
      await sql.query("UPDATE seo_worker_stores SET enabled=false WHERE store_id=$1", [storeId]);
      // Re-running drain after the legacy TTL expires recovers abandoned batches without a new claim.
      // VALIDATING jobs remain blocked until their existing finalizer completes.
      await this.recoverExpired(storeId);
      await sql.query("INSERT INTO gpt_audit(store_id,event,created_at) VALUES ($1,$2,$3)", [storeId, `WORKER_DRAIN:${operator}`, this.now()]);
    });
  }
  async apply(storeId: string, fingerprint: string, operator: string): Promise<{ imported: number }> {
    return this.database.transaction(async sql => {
      const report = await this.report(sql, storeId);
      if (!report.draining) throw new SeoWorkerError("CUTOVER_NOT_DRAINING");
      if (report.fingerprint !== fingerprint) throw new SeoWorkerError("BACKUP_STALE");
      if (!report.converted && (report.activeBatches.length || report.duplicates.length || report.blocked.length)) throw new SeoWorkerError("CUTOVER_BLOCKED");
      const result = await this.enable(storeId);
      await sql.query("UPDATE seo_worker_cutovers SET draining=false WHERE store_id=$1", [storeId]);
      await sql.query("INSERT INTO gpt_audit(store_id,event,created_at) VALUES ($1,$2,$3)", [storeId, `WORKER_CUTOVER:${operator}:${fingerprint}`, this.now()]);
      return result;
    });
  }
}
