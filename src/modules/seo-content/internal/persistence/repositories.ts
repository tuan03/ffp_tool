import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { queryOne, queryRows, withSeoTransaction } from "./postgres";

export type SeoPipelineRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SeoPipelineRunRecord {
  readonly runId: string;
  readonly inputHash: string;
  readonly storeId?: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly sourceVersion?: string;
  readonly shopifyUpdatedAt?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly pipelineVersion?: string;
  readonly status: SeoPipelineRunStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly lastError?: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt?: number;
}

interface PipelineRunRow {
  run_id: string;
  input_hash: string;
  store_id: string | null;
  product_id: string | null;
  handle: string | null;
  source_version: string | null;
  shopify_updated_at: Date | null;
  provider_id: string | null;
  model: string | null;
  pipeline_version: string | null;
  status: SeoPipelineRunStatus;
  metadata: Record<string, unknown>;
  last_error: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

function mapPipelineRun(row: PipelineRunRow): SeoPipelineRunRecord {
  return {
    runId: row.run_id,
    inputHash: row.input_hash,
    storeId: row.store_id ?? undefined,
    productId: row.product_id ?? undefined,
    handle: row.handle ?? undefined,
    sourceVersion: row.source_version ?? undefined,
    shopifyUpdatedAt: row.shopify_updated_at?.toISOString(),
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    pipelineVersion: row.pipeline_version ?? undefined,
    status: row.status,
    metadata: row.metadata,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    expiresAt: row.expires_at?.getTime(),
  };
}

export class PostgresSeoPipelineRunRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsert(record: SeoPipelineRunRecord, client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    await executor.query(
      `INSERT INTO seo_pipeline_runs(
        run_id, input_hash, store_id, product_id, handle, source_version,
        shopify_updated_at, provider_id, model, pipeline_version, status,
        metadata, last_error, created_at, updated_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)
      ON CONFLICT (input_hash) DO UPDATE SET
        store_id = EXCLUDED.store_id,
        product_id = EXCLUDED.product_id, handle = EXCLUDED.handle,
        source_version = EXCLUDED.source_version,
        shopify_updated_at = EXCLUDED.shopify_updated_at,
        provider_id = EXCLUDED.provider_id, model = EXCLUDED.model,
        pipeline_version = EXCLUDED.pipeline_version, status = EXCLUDED.status,
        metadata = EXCLUDED.metadata, last_error = EXCLUDED.last_error,
        updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at`,
      [record.runId, record.inputHash, record.storeId ?? null, record.productId ?? null,
        record.handle ?? null, record.sourceVersion ?? null, record.shopifyUpdatedAt ?? null,
        record.providerId ?? null, record.model ?? null, record.pipelineVersion ?? null,
        record.status, JSON.stringify(record.metadata ?? {}), JSON.stringify(record.lastError ?? null),
        new Date(record.createdAt), new Date(record.updatedAt), record.expiresAt ? new Date(record.expiresAt) : null],
    );
  }

  public async findByInputHash(inputHash: string): Promise<SeoPipelineRunRecord | undefined> {
    const row = await queryOne<PipelineRunRow>(this.pool, "SELECT * FROM seo_pipeline_runs WHERE input_hash = $1", [inputHash]);
    return row ? mapPipelineRun(row) : undefined;
  }

  public async findRecoverable(limit: number = 100): Promise<readonly SeoPipelineRunRecord[]> {
    const rows = await queryRows<PipelineRunRow>(this.pool,
      `SELECT * FROM seo_pipeline_runs
       WHERE status IN ('pending','running','failed') AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY updated_at ASC LIMIT $1`, [limit]);
    return rows.map(mapPipelineRun);
  }
}

export interface SeoResultCacheRecord {
  readonly cacheKey: string;
  readonly storeId?: string;
  readonly productId?: string;
  readonly inputHash: string;
  readonly sourceVersion?: string;
  readonly imageFingerprint?: string;
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly pipelineVersion: string;
  readonly result: unknown;
  readonly expiresAt: number;
}

export class PostgresSeoResultCache {
  public constructor(private readonly pool: Pool) {}

  public async get(cacheKey: string): Promise<unknown | undefined> {
    const row = await queryOne<{ result: unknown }>(this.pool,
      "SELECT result FROM seo_result_cache WHERE cache_key = $1 AND expires_at > NOW()", [cacheKey]);
    return row?.result;
  }

  public async set(record: SeoResultCacheRecord, client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(
      `INSERT INTO seo_result_cache(cache_key,store_id,product_id,input_hash,source_version,
        image_fingerprint,variant_summary_hash,provider_id,model,prompt_version,pipeline_version,result,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
       ON CONFLICT(cache_key) DO UPDATE SET result=EXCLUDED.result, expires_at=EXCLUDED.expires_at`,
      [record.cacheKey, record.storeId ?? null, record.productId ?? null, record.inputHash,
        record.sourceVersion ?? null, record.imageFingerprint ?? null, null,
        record.providerId, record.model, record.promptVersion, record.pipelineVersion,
        JSON.stringify(record.result), new Date(record.expiresAt)],
    );
  }

  public async pruneExpired(): Promise<number> {
    const result = await this.pool.query("DELETE FROM seo_result_cache WHERE expires_at <= NOW()");
    return result.rowCount ?? 0;
  }
}

export interface SeoProviderCircuitRecord {
  readonly providerId: string;
  readonly model: string;
  readonly state: "closed" | "open" | "half_open";
  readonly failureCount: number;
  readonly openedAt?: number;
  readonly retryAfter?: number;
  readonly lastError?: Readonly<Record<string, unknown>>;
}

export class PostgresSeoProviderCircuitRepository {
  public constructor(private readonly pool: Pool) {}

  public async get(providerId: string, model: string): Promise<SeoProviderCircuitRecord | undefined> {
    const row = await queryOne<{
      provider_id: string; model: string; state: SeoProviderCircuitRecord["state"];
      failure_count: number; opened_at: Date | null; retry_after: Date | null;
      last_error: Record<string, unknown> | null;
    }>(this.pool, "SELECT * FROM seo_provider_circuits WHERE provider_id=$1 AND model=$2", [providerId, model]);
    return row ? { providerId: row.provider_id, model: row.model, state: row.state,
      failureCount: row.failure_count, openedAt: row.opened_at?.getTime(),
      retryAfter: row.retry_after?.getTime(), lastError: row.last_error ?? undefined } : undefined;
  }

  public async set(record: SeoProviderCircuitRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO seo_provider_circuits(provider_id,model,state,failure_count,opened_at,retry_after,last_error)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT(provider_id,model) DO UPDATE SET state=EXCLUDED.state,
       failure_count=EXCLUDED.failure_count,opened_at=EXCLUDED.opened_at,
       retry_after=EXCLUDED.retry_after,last_error=EXCLUDED.last_error,updated_at=NOW()`,
      [record.providerId, record.model, record.state, record.failureCount,
        record.openedAt ? new Date(record.openedAt) : null,
        record.retryAfter ? new Date(record.retryAfter) : null,
        JSON.stringify(record.lastError ?? null)],
    );
  }

  public async tryAcquireProbe(
    providerId: string,
    model: string,
    now: number,
    probeLeaseMs: number = 30_000,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE seo_provider_circuits SET state='half_open',retry_after=$4,updated_at=$3
       WHERE provider_id=$1 AND model=$2
         AND state IN ('open','half_open') AND retry_after <= $3`,
      [providerId, model, new Date(now), new Date(now + probeLeaseMs)],
    );
    return (result.rowCount ?? 0) === 1;
  }

  public async recordFailure(
    providerId: string,
    model: string,
    now: number,
    error: Readonly<Record<string, unknown>>,
    threshold: number,
    retryAfterMs: number,
  ): Promise<SeoProviderCircuitRecord> {
    const safeThreshold = Math.max(1, Math.trunc(threshold));
    const row = await queryOne<{
      state: SeoProviderCircuitRecord["state"];
      failure_count: number;
      opened_at: Date | null;
      retry_after: Date | null;
      last_error: Record<string, unknown> | null;
    }>(this.pool,
      `INSERT INTO seo_provider_circuits(provider_id,model,state,failure_count,opened_at,retry_after,last_error,updated_at)
       VALUES($1,$2,CASE WHEN $5 <= 1 THEN 'open' ELSE 'closed' END,1,
         CASE WHEN $5 <= 1 THEN $3::timestamptz ELSE NULL END,
         CASE WHEN $5 <= 1 THEN $4::timestamptz ELSE NULL END,$6::jsonb,$3::timestamptz)
       ON CONFLICT(provider_id,model) DO UPDATE SET
         failure_count=seo_provider_circuits.failure_count+1,
         state=CASE WHEN seo_provider_circuits.failure_count+1 >= $5 THEN 'open' ELSE 'closed' END,
         opened_at=CASE WHEN seo_provider_circuits.failure_count+1 >= $5 THEN $3::timestamptz ELSE NULL END,
         retry_after=CASE WHEN seo_provider_circuits.failure_count+1 >= $5 THEN $4::timestamptz ELSE NULL END,
         last_error=$6::jsonb,updated_at=$3::timestamptz
       RETURNING state,failure_count,opened_at,retry_after,last_error`,
      [providerId, model, new Date(now), new Date(now + retryAfterMs), safeThreshold, JSON.stringify(error)]);
    if (!row) throw new Error("Failed to persist provider circuit failure");
    return { providerId, model, state: row.state, failureCount: row.failure_count,
      openedAt: row.opened_at?.getTime(), retryAfter: row.retry_after?.getTime(),
      lastError: row.last_error ?? undefined };
  }

  public async recordSuccess(providerId: string, model: string, now: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO seo_provider_circuits(provider_id,model,state,failure_count,updated_at)
       VALUES($1,$2,'closed',0,$3)
       ON CONFLICT(provider_id,model) DO UPDATE SET state='closed',failure_count=0,
       opened_at=NULL,retry_after=NULL,last_error=NULL,updated_at=$3`,
      [providerId, model, new Date(now)],
    );
  }
}

export interface CompleteSeoRunParams {
  readonly run: SeoPipelineRunRecord;
  readonly handoffId?: string;
  readonly handoffPayload: unknown;
  readonly outboxEventId?: string;
  readonly eventType?: string;
}

export interface SeoOutboxDelivery {
  readonly eventId: string;
  readonly handoffId?: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly attemptCount: number;
}

export class PostgresSeoCompletionRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly runs: PostgresSeoPipelineRunRepository = new PostgresSeoPipelineRunRepository(pool),
  ) {}

  public async complete(params: CompleteSeoRunParams): Promise<{ handoffId: string; eventId: string }> {
    const handoffId = params.handoffId ?? randomUUID();
    const eventId = params.outboxEventId ?? randomUUID();
    await withSeoTransaction(this.pool, async client => {
      await this.runs.upsert({ ...params.run, status: "completed", updatedAt: Date.now() }, client);
      const persistedRun = await queryOne<{ run_id: string }>(client,
        "SELECT run_id FROM seo_pipeline_runs WHERE input_hash=$1", [params.run.inputHash]);
      if (!persistedRun) throw new Error("Completed SEO run was not persisted");
      await client.query(
        `INSERT INTO seo_review_handoffs(handoff_id,run_id,store_id,product_id,source_version,input_hash,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(handoff_id) DO UPDATE SET
         payload=EXCLUDED.payload,status='pending',published_at=NULL`,
        [handoffId, persistedRun.run_id, params.run.storeId ?? null, params.run.productId ?? null,
          params.run.sourceVersion ?? null, params.run.inputHash, JSON.stringify(params.handoffPayload)],
      );
      await client.query(
        `INSERT INTO seo_outbox(event_id,handoff_id,aggregate_id,event_type,payload)
         VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_id) DO UPDATE SET
         handoff_id=EXCLUDED.handoff_id,payload=EXCLUDED.payload,published_at=NULL,
         locked_by=NULL,locked_until=NULL,next_attempt_at=NOW(),last_error=NULL`,
        [eventId, handoffId, persistedRun.run_id, params.eventType ?? "seo.review.pending",
          JSON.stringify(params.handoffPayload)],
      );
    });
    return { handoffId, eventId };
  }

  public async markPublished(handoffId: string, eventId: string): Promise<void> {
    await withSeoTransaction(this.pool, async client => {
      await client.query(
        "UPDATE seo_review_handoffs SET status='published',published_at=NOW() WHERE handoff_id=$1",
        [handoffId],
      );
      await client.query(
        "UPDATE seo_outbox SET published_at=NOW(),locked_by=NULL,locked_until=NULL,last_error=NULL WHERE event_id=$1",
        [eventId],
      );
    });
  }

  public async claimPending(
    workerId: string,
    limit: number = 10,
    leaseMs: number = 30_000,
  ): Promise<readonly SeoOutboxDelivery[]> {
    return withSeoTransaction(this.pool, async client => {
      const rows = await queryRows<{
        event_id: string; handoff_id: string | null; aggregate_id: string;
        event_type: string; payload: unknown; attempt_count: number;
      }>(client,
        `WITH candidates AS (
           SELECT event_id FROM seo_outbox
           WHERE published_at IS NULL AND next_attempt_at <= NOW()
             AND (locked_until IS NULL OR locked_until <= NOW())
           ORDER BY created_at ASC
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE seo_outbox AS event SET locked_by=$2,locked_until=NOW()+($3 * INTERVAL '1 millisecond'),
           attempt_count=event.attempt_count+1
         FROM candidates
         WHERE event.event_id=candidates.event_id
         RETURNING event.event_id,event.handoff_id,event.aggregate_id,
           event.event_type,event.payload,event.attempt_count`,
        [Math.max(1, Math.min(100, Math.trunc(limit))), workerId, Math.max(1_000, leaseMs)]);
      return rows.map(row => ({ eventId: row.event_id, handoffId: row.handoff_id ?? undefined,
        aggregateId: row.aggregate_id, eventType: row.event_type, payload: row.payload,
        attemptCount: row.attempt_count }));
    });
  }

  public async recordDeliveryFailure(
    eventId: string,
    workerId: string,
    error: string,
    retryDelayMs: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE seo_outbox SET locked_by=NULL,locked_until=NULL,last_error=$3,
       next_attempt_at=NOW()+($4 * INTERVAL '1 millisecond')
       WHERE event_id=$1 AND published_at IS NULL
         AND (locked_by=$2 OR (locked_by IS NULL AND payload->>'workerId'=$2))`,
      [eventId, workerId, error.slice(0, 2_000), Math.max(1_000, retryDelayMs)],
    );
  }
}
