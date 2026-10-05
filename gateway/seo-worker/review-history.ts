import type { WorkerReviewHistory } from "../../src/modules/custom-gpt-seo";
import type { WorkerDatabase } from "./database";
import { SeoWorkerError } from "./protocol";

export class SeoReviewHistoryRepository {
  constructor(private readonly database: WorkerDatabase) {}
  async list(storeId: string, jobId: string, offset: number): Promise<WorkerReviewHistory> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new SeoWorkerError("INVALID_OFFSET");
    return this.database.transaction(async sql => {
      if (!(await sql.query("SELECT id FROM gpt_jobs WHERE store_id=$1 AND id=$2", [storeId, jobId])).rows.length) throw new SeoWorkerError("JOB_NOT_FOUND");
      // Chains are linear (unique parent and successor). UNION also terminates malformed cycles.
      const chain = `WITH RECURSIVE ancestors(id) AS (
        SELECT id FROM gpt_jobs WHERE store_id=$1 AND id=$2 UNION
        SELECT r.previous_job_id FROM seo_worker_revisions r JOIN ancestors a ON a.id=r.job_id WHERE r.store_id=$1
      ), family(id) AS (SELECT id FROM ancestors UNION SELECT r.job_id FROM seo_worker_revisions r JOIN family f ON f.id=r.previous_job_id WHERE r.store_id=$1)`;
      const total = Number((await sql.query(`${chain} SELECT count(*) AS count FROM family`, [storeId, jobId])).rows[0].count);
      const rows = (await sql.query(`${chain} SELECT j.id,j.status,j.created_at,j.payload::jsonb->'original'->>'updatedAt' AS source_version,
        j.payload::jsonb->'settings'->>'version' AS rules_version,j.payload::jsonb->'checkpoints' AS checkpoints,
        w.worker_id,w.run_id,w.attempt_count,w.last_error_code,r.previous_job_id,p.state AS publish_state,p.seo_version,
        (SELECT count(*) FROM seo_worker_image_receipts i WHERE i.job_id=j.id) AS image_receipts
        FROM family f JOIN gpt_jobs j ON j.id=f.id LEFT JOIN seo_worker_jobs w ON w.job_id=j.id
        LEFT JOIN seo_worker_revisions r ON r.job_id=j.id AND r.store_id=$1
        LEFT JOIN seo_publish_operations p ON p.job_id=j.id WHERE j.store_id=$1
        ORDER BY j.created_at,j.id LIMIT 50 OFFSET $3`, [storeId, jobId, offset])).rows;
      const text = (value: unknown): string | null => value == null ? null : String(value);
      return { total, nextOffset: offset + rows.length < total ? offset + rows.length : null, entries: rows.map(row => ({
        jobId: String(row.id), previousJobId: text(row.previous_job_id), status: String(row.status), workerId: text(row.worker_id), runId: text(row.run_id),
        attemptCount: Number(row.attempt_count ?? 0), sourceVersion: text(row.source_version), rulesVersion: row.rules_version == null ? null : Number(row.rules_version),
        checkpoints: row.checkpoints && typeof row.checkpoints === "object" ? Object.keys(row.checkpoints) : [], imageReceipts: Number(row.image_receipts),
        errorCode: text(row.last_error_code), publishState: text(row.publish_state), seoVersion: row.seo_version == null ? null : Number(row.seo_version), createdAt: Number(row.created_at),
      })) };
    });
  }
}
