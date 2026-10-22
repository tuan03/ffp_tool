import { Pool } from "pg";

import type { GenerateReviewInput, generateReviewSamples } from "./amazon-reviews-generator";

export type ReviewTextStatus = "queued" | "running" | "validating" | "saving" | "save_failed" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
export type ReviewTextResult = Awaited<ReturnType<typeof generateReviewSamples>>;
export interface ReviewTextJob {
  readonly id: string;
  readonly requestId: string;
  readonly contextJobId: string;
  readonly storeId: string;
  readonly count: number;
  readonly createdAt: string;
  status: ReviewTextStatus;
  updatedAt: string;
  error?: string;
  input?: GenerateReviewInput;
  result?: ReviewTextResult;
}
export interface ReviewTextRepository {
  insert(job: ReviewTextJob): Promise<ReviewTextJob>;
  get(id: string): Promise<ReviewTextJob | null>;
  byRequest(requestId: string): Promise<ReviewTextJob | null>;
  latest(contextJobId: string, storeId: string): Promise<ReviewTextJob | null>;
  update(job: ReviewTextJob): Promise<void>;
  recover(): Promise<void>;
  close(): Promise<void>;
}
export interface ReviewTextSqlClient {
  query<T extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<unknown>;
}

export class PostgresReviewTextRepository implements ReviewTextRepository {
  private readonly pool: ReviewTextSqlClient;
  constructor(databaseUrl: string, client?: ReviewTextSqlClient) { this.pool = client ?? new Pool({ connectionString: databaseUrl, max: 3 }); }
  async initialize(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS review_text_jobs (
      id text PRIMARY KEY, request_id text NOT NULL UNIQUE, context_job_id text NOT NULL,
      store_id text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS review_text_one_active_context ON review_text_jobs(context_job_id)
      WHERE status IN ('queued','running','validating','saving','save_failed');`);
  }
  async insert(job: ReviewTextJob): Promise<ReviewTextJob> {
    const inserted = await this.pool.query<{ payload: ReviewTextJob }>(
      `INSERT INTO review_text_jobs(id,request_id,context_job_id,store_id,status,payload)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING payload`,
      [job.id, job.requestId, job.contextJobId, job.storeId, job.status, JSON.stringify(job)]);
    if (inserted.rows[0]) return inserted.rows[0].payload;
    const prior = await this.pool.query<{ payload: ReviewTextJob }>(`SELECT payload FROM review_text_jobs WHERE request_id=$1 OR
      (context_job_id=$2 AND status IN ('queued','running','validating','saving','save_failed')) ORDER BY created_at DESC LIMIT 1`, [job.requestId, job.contextJobId]);
    if (!prior.rows[0]) throw new Error("REVIEW_REQUEST_CONFLICT");
    return prior.rows[0].payload;
  }
  async get(id: string): Promise<ReviewTextJob | null> {
    return (await this.pool.query<{ payload: ReviewTextJob }>("SELECT payload FROM review_text_jobs WHERE id=$1", [id])).rows[0]?.payload ?? null;
  }
  async byRequest(requestId: string): Promise<ReviewTextJob | null> {
    return (await this.pool.query<{ payload: ReviewTextJob }>("SELECT payload FROM review_text_jobs WHERE request_id=$1", [requestId])).rows[0]?.payload ?? null;
  }
  async latest(contextJobId: string, storeId: string): Promise<ReviewTextJob | null> {
    return (await this.pool.query<{ payload: ReviewTextJob }>("SELECT payload FROM review_text_jobs WHERE context_job_id=$1 AND store_id=$2 ORDER BY created_at DESC LIMIT 1", [contextJobId, storeId])).rows[0]?.payload ?? null;
  }
  async update(job: ReviewTextJob): Promise<void> {
    await this.pool.query("UPDATE review_text_jobs SET status=$2,payload=$3 WHERE id=$1", [job.id, job.status, JSON.stringify(job)]);
  }
  async recover(): Promise<void> {
    // One Gateway owns these jobs. Never replay a browser action after a restart.
    await this.pool.query(`UPDATE review_text_jobs SET status=CASE WHEN payload ? 'result' THEN 'save_failed' ELSE 'interrupted' END,
      payload=payload || jsonb_build_object('status',CASE WHEN payload ? 'result' THEN 'save_failed' ELSE 'interrupted' END,
      'error','Server đã khởi động lại. Kết quả đã nhận được giữ nguyên; kiểm tra ChatGPT trước khi tạo lại.')
      WHERE status IN ('queued','running','validating','saving')`);
  }
  async close(): Promise<void> { await this.pool.end(); }
}
