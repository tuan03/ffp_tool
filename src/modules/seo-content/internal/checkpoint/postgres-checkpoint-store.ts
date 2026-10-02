import type { Pool } from "pg";

import { queryOne, queryRows, withSeoTransaction } from "../persistence/postgres";
import type { SeoCheckpoint, SeoCheckpointStore, SeoStageCheckpoint } from "./types";

interface CheckpointHeaderRow {
  input_hash: string;
  store_id: string | null;
  product_id: string | null;
  handle: string | null;
  source_version: string | null;
  shopify_updated_at: Date | null;
  provider_id: string | null;
  pipeline_version: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

interface StageRow {
  stage: string;
  checkpoint: SeoStageCheckpoint;
}

function deriveRunStatus(checkpoint: SeoCheckpoint): "pending" | "running" | "failed" {
  const stages = Object.values(checkpoint.stages);
  if (stages.some(stage => stage?.status === "failed")) return "failed";
  if (stages.some(stage => stage?.status === "running")) return "running";
  return stages.length > 0 ? "running" : "pending";
}

/** Durable checkpoint store. A checkpoint and every changed stage commit atomically. */
export class PostgresSeoCheckpointStore implements SeoCheckpointStore {
  public constructor(private readonly pool: Pool) {}

  public async get(inputHash: string): Promise<SeoCheckpoint | null> {
    const header = await queryOne<CheckpointHeaderRow>(this.pool,
      `SELECT input_hash,store_id,product_id,handle,source_version,shopify_updated_at,provider_id,pipeline_version,
        metadata,created_at,updated_at,expires_at
       FROM seo_pipeline_runs WHERE input_hash=$1`, [inputHash]);
    if (!header) return null;
    const rows = await queryRows<StageRow>(this.pool,
      "SELECT stage,checkpoint FROM seo_stage_checkpoints WHERE input_hash=$1 ORDER BY stage", [inputHash]);
    const stages: Record<string, SeoStageCheckpoint> = {};
    for (const row of rows) stages[row.stage] = row.checkpoint;
    const schemaVersion = header.metadata.checkpointSchemaVersion === 1 ? 1 : 1;
    return {
      schemaVersion,
      inputHash: header.input_hash,
      storeId: header.store_id ?? undefined,
      productId: header.product_id ?? undefined,
      handle: header.handle ?? undefined,
      sourceVersion: header.source_version ?? undefined,
      shopifyUpdatedAt: header.shopify_updated_at?.toISOString(),
      providerId: header.provider_id ?? undefined,
      pipelineVersion: header.pipeline_version ?? undefined,
      createdAt: header.created_at.getTime(),
      updatedAt: header.updated_at.getTime(),
      expiresAt: header.expires_at?.getTime() ?? Number.MAX_SAFE_INTEGER,
      stages,
    };
  }

  public async set(checkpoint: SeoCheckpoint): Promise<void> {
    await withSeoTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [checkpoint.inputHash]);
      await client.query(
        `INSERT INTO seo_pipeline_runs(run_id,input_hash,store_id,product_id,handle,source_version,
           shopify_updated_at,provider_id,pipeline_version,status,metadata,created_at,updated_at,expires_at)
         VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
         ON CONFLICT(input_hash) DO UPDATE SET store_id=EXCLUDED.store_id,
           product_id=EXCLUDED.product_id,handle=EXCLUDED.handle,status=EXCLUDED.status,
           source_version=EXCLUDED.source_version,shopify_updated_at=EXCLUDED.shopify_updated_at,
           provider_id=EXCLUDED.provider_id,pipeline_version=EXCLUDED.pipeline_version,
           metadata=seo_pipeline_runs.metadata || EXCLUDED.metadata,
           updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at
         WHERE EXCLUDED.updated_at >= seo_pipeline_runs.updated_at`,
        [checkpoint.inputHash, checkpoint.storeId ?? null, checkpoint.productId ?? null,
          checkpoint.handle ?? null, checkpoint.sourceVersion ?? null, checkpoint.shopifyUpdatedAt ?? null,
          checkpoint.providerId ?? null, checkpoint.pipelineVersion ?? null, deriveRunStatus(checkpoint),
          JSON.stringify({ checkpointSchemaVersion: checkpoint.schemaVersion }),
          new Date(checkpoint.createdAt), new Date(checkpoint.updatedAt), new Date(checkpoint.expiresAt)],
      );
      for (const [stageName, stage] of Object.entries(checkpoint.stages)) {
        if (!stage) continue;
        await client.query(
          `INSERT INTO seo_stage_checkpoints(input_hash,stage,stage_hash,upstream_hash,status,prompt_version,
             model,checkpoint,duration_ms,retry_log,last_error,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$13)
           ON CONFLICT(input_hash,stage) DO UPDATE SET stage_hash=EXCLUDED.stage_hash,
             upstream_hash=EXCLUDED.upstream_hash,status=EXCLUDED.status,
             prompt_version=EXCLUDED.prompt_version,model=EXCLUDED.model,
             checkpoint=EXCLUDED.checkpoint,duration_ms=EXCLUDED.duration_ms,
             retry_log=EXCLUDED.retry_log,last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at
           WHERE EXCLUDED.updated_at >= seo_stage_checkpoints.updated_at`,
          [checkpoint.inputHash, stageName, stage.stageHash, stage.upstreamHash ?? null,
            stage.status, stage.promptVersion ?? null, stage.model ?? null, JSON.stringify(stage),
            stage.durationMs, JSON.stringify(stage.retryLogs), JSON.stringify(stage.error ?? null),
            new Date(stage.createdAt), new Date(stage.updatedAt)],
        );
      }
    });
  }

  public async delete(inputHash: string): Promise<void> {
    await this.pool.query("DELETE FROM seo_pipeline_runs WHERE input_hash=$1", [inputHash]);
  }

  public async pruneExpired(now: number = Date.now()): Promise<number> {
    const result = await this.pool.query("DELETE FROM seo_pipeline_runs WHERE expires_at <= $1", [new Date(now)]);
    return result.rowCount ?? 0;
  }
}
