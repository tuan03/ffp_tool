import { createHash, randomUUID } from "node:crypto";
import { canonicalizeJson } from "../canonical-json";
import type { WorkerMetrics } from "../../src/modules/custom-gpt-seo";
import type { WorkerDatabase } from "./database";
import { SeoWorkerError } from "./protocol";

const EVENTS = ["TOKEN_EXPIRED", "STALE_LEASE", "STALE_SOURCE", "DUPLICATE_SUBMISSION"] as const;

export class SeoWorkerMetrics {
  constructor(private readonly database: WorkerDatabase, private readonly now: () => number = Date.now) {}

  /** Called outside a rejected mutation's transaction, so rollback cannot erase the observation. */
  async record(token: string, code: string): Promise<void> {
    if (!EVENTS.some(event => event === code)) return;
    try {
      await this.database.transaction(async sql => {
        const tokenHash = createHash("sha256").update(canonicalizeJson(token)).digest("hex");
        await sql.query(`INSERT INTO seo_worker_metric_events(id,store_id,kind,occurred_at)
          SELECT $1,store_id,$2,$3 FROM seo_worker_tokens WHERE token_hash=$4`, [randomUUID(), code, this.now(), tokenHash]);
      });
    } catch { console.error("[SEO Worker metrics] Observation unavailable; worker result unchanged."); }
  }

  async report(storeId: string, hours: number): Promise<WorkerMetrics> {
    if (![24, 168, 720].includes(hours)) throw new SeoWorkerError("INVALID_METRICS_WINDOW");
    const end = this.now(), start = end - hours * 3600000, bucketHours = hours === 24 ? 1 : 24;
    return this.database.transaction(async sql => {
      const states = (await sql.query(`SELECT w.state,count(*) AS count FROM seo_worker_jobs w JOIN gpt_jobs j ON j.id=w.job_id
        WHERE w.store_id=$1 AND j.provider='codex_mcp' GROUP BY w.state`, [storeId])).rows;
      const attempts = (await sql.query(`SELECT count(*) FILTER (WHERE a.started_at >= $2 AND a.started_at < $3) AS started,
        count(*) FILTER (WHERE a.started_at >= $2 AND a.started_at < $3 AND a.lease_version>1) AS retried,
        count(*) FILTER (WHERE a.ended_at >= $2 AND a.ended_at < $3) AS ended,
        count(*) FILTER (WHERE a.ended_at >= $2 AND a.ended_at < $3 AND a.result!='SUCCESS') AS failed,
        avg(a.ended_at-a.started_at) FILTER (WHERE a.ended_at >= $2 AND a.ended_at < $3 AND a.result='SUCCESS') AS duration,
        count(*) FILTER (WHERE a.ended_at >= $2 AND a.ended_at < $3 AND a.result='LEASE_EXPIRED') AS expired,
        count(*) FILTER (WHERE a.ended_at >= $2 AND a.ended_at < $3 AND a.result IN ('AGENT_QUOTA_EXHAUSTED','QUOTA_EXHAUSTED')) AS quota
        FROM seo_worker_attempts a JOIN gpt_jobs j ON j.id=a.job_id WHERE j.store_id=$1 AND j.provider='codex_mcp'
        AND (a.started_at >= $2 OR a.ended_at >= $2)`, [storeId, start, end])).rows[0];
      const completed = (await sql.query(`SELECT floor((s.completed_at-$2::bigint)/$4::numeric)::int AS bucket,count(*) AS count
        FROM seo_worker_successes s JOIN gpt_jobs j ON j.id=s.job_id WHERE j.store_id=$1 AND j.provider='codex_mcp'
        AND s.completed_at >= $2 AND s.completed_at < $3 GROUP BY bucket`, [storeId, start, end, bucketHours * 3600000])).rows;
      const events = (await sql.query("SELECT kind,count(*) AS count FROM seo_worker_metric_events WHERE store_id=$1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY kind", [storeId, start, end])).rows;
      const tokens = (await sql.query("SELECT count(*) AS count FROM seo_worker_tokens WHERE store_id=$1 AND expires_at >= $2 AND expires_at < $3 AND (revoked_at IS NULL OR revoked_at >= expires_at)", [storeId, start, end])).rows[0];
      const coverage = (await sql.query("SELECT started_at FROM seo_worker_metric_coverage WHERE id=true")).rows[0];
      const eventCount = (kind: string): number => Number(events.find(row => row.kind === kind)?.count ?? 0);
      const counts = Object.fromEntries(states.map(row => [String(row.state), Number(row.count)]));
      const successes = completed.reduce((sum, row) => sum + Number(row.count), 0);
      const started = Number(attempts.started), ended = Number(attempts.ended);
      return { generatedAt: end, start, end, eventCoverageSince: Number(coverage.started_at), hours, bucketHours,
        states: counts, queueDepth: (counts.READY ?? 0) + (counts.RETRY_WAIT ?? 0), successfulJobs: successes,
        jobsPerHour: successes / hours, attemptsStarted: started, attemptsEnded: ended, retriedAttempts: Number(attempts.retried), failedAttempts: Number(attempts.failed),
        retryRate: started ? Number(attempts.retried) / started : null, failureRate: ended ? Number(attempts.failed) / ended : null,
        averageProcessingMs: attempts.duration == null ? null : Number(attempts.duration), leaseExpirations: Number(attempts.expired), quotaFailures: Number(attempts.quota),
        tokenExpirations: Number(tokens.count), expiredTokenRequests: eventCount("TOKEN_EXPIRED"), duplicateSubmissionsPrevented: eventCount("DUPLICATE_SUBMISSION"), staleLeaseRejections: eventCount("STALE_LEASE"), staleSourceRejections: eventCount("STALE_SOURCE"),
        series: Array.from({ length: hours / bucketHours }, (_, bucket) => ({ start: start + bucket * bucketHours * 3600000, completed: Number(completed.find(row => Number(row.bucket) === bucket)?.count ?? 0) })),
      };
    });
  }
}
