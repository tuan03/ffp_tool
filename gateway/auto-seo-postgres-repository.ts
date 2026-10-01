import { Pool } from "pg";
import type { PoolClient } from "pg";

import { getAutoSeoPostgresSchemaSql } from "./auto-seo-postgres-schema";
import { loadLocalEnv } from "./store-config-loader";
import type { AutoSeoBackupRepository } from "./auto-seo-backup-repository";

export interface AutoSeoPostgresBackupInput {
  readonly backupId: string;
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly productId: string;
  readonly productHandle: string;
  readonly productTitle: string;
  readonly shopifyUpdatedAt?: string | null;
  readonly snapshotJson: string;
  readonly snapshotSha256: string;
  readonly seoInputSha256?: string | null;
}

export interface AutoSeoPostgresBackup extends AutoSeoPostgresBackupInput {
  readonly id: string;
  readonly shopifyUpdatedAt: string | null;
  readonly gptSettingsJson: string | null;
  readonly downstreamStatus: "NOT_SENT" | "SENT" | "FAILED";
  readonly downstreamHttpStatus: number | null;
  readonly downstreamError: string | null;
  readonly downstreamSentAt: string | null;
  readonly createdAt: string;
}

export interface AutoSeoPostgresRepositoryOptions {
  readonly databaseUrl: string;
  readonly schema?: string;
}

export interface AutoSeoPostgresInsertOptions {
  readonly onConflict?: "error" | "update";
  readonly gptSettingsJson?: string;
}

export interface AutoSeoPostgresClaimResult {
  readonly acceptedRecords: readonly AutoSeoPostgresBackupInput[];
  readonly skippedProducts: readonly {
    readonly productId: string;
    readonly reason: "UNCHANGED" | "ACTIVE_DUPLICATE";
  }[];
}

interface BackupRow {
  readonly id: string;
  readonly backup_id: string;
  readonly workflow_id: string;
  readonly store_id: string;
  readonly shop_domain: string;
  readonly product_id: string;
  readonly product_handle: string;
  readonly product_title: string;
  readonly shopify_updated_at: string | null;
  readonly snapshot_json: string;
  readonly snapshot_sha256: string;
  readonly seo_input_sha256: string | null;
  readonly gpt_settings_json: string | null;
  readonly downstream_status: "NOT_SENT" | "SENT" | "FAILED";
  readonly downstream_http_status: number | null;
  readonly downstream_error: string | null;
  readonly downstream_sent_at: string | null;
  readonly created_at: string;
}

function mapBackup(row: BackupRow): AutoSeoPostgresBackup {
  return {
    id: row.id,
    backupId: row.backup_id,
    workflowId: row.workflow_id,
    storeId: row.store_id,
    shopDomain: row.shop_domain,
    productId: row.product_id,
    productHandle: row.product_handle,
    productTitle: row.product_title,
    shopifyUpdatedAt: row.shopify_updated_at,
    snapshotJson: row.snapshot_json,
    snapshotSha256: row.snapshot_sha256,
    seoInputSha256: row.seo_input_sha256 ?? "",
    gptSettingsJson: row.gpt_settings_json,
    downstreamStatus: row.downstream_status,
    downstreamHttpStatus: row.downstream_http_status,
    downstreamError: row.downstream_error,
    downstreamSentAt: row.downstream_sent_at,
    createdAt: row.created_at,
  };
}

function validateDatabaseUrl(databaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("AUTO_SEO_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgresql:" || !url.hostname || !url.pathname.slice(1) || !url.username || !url.password) {
    throw new Error("AUTO_SEO_DATABASE_URL must use postgresql:// with host, database, user, and password");
  }
  return url;
}

export function requireLocalAutoSeoDatabase(databaseUrl: string): void {
  const url = validateDatabaseUrl(databaseUrl);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5432" ||
    url.pathname !== "/ffp_tool" ||
    decodeURIComponent(url.username) !== "ffp_tool"
  ) {
    throw new Error("Auto SEO B1 requires local PostgreSQL at 127.0.0.1:5432/ffp_tool as ffp_tool");
  }
}

export class AutoSeoPostgresRepository implements AutoSeoBackupRepository {
  private readonly pool: Pool;
  private readonly schema: string;
  private verifiedTarget: Promise<void> | undefined;

  public constructor(options: AutoSeoPostgresRepositoryOptions) {
    validateDatabaseUrl(options.databaseUrl);
    const schema = options.schema ?? "public";
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
      throw new Error("Invalid PostgreSQL schema identifier");
    }
    this.schema = schema;
    this.pool = new Pool({ connectionString: options.databaseUrl });
  }

  public async verifyLocalTarget(): Promise<void> {
    if (!this.verifiedTarget) {
      this.verifiedTarget = this.pool.query<{
        database_name: string;
        user_name: string;
        server_port: number;
      }>(
        "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
      ).then(({ rows }) => {
        const target = rows[0];
        if (
          target?.database_name !== "ffp_tool" ||
          target.user_name !== "ffp_tool" ||
          target.server_port !== 5432
        ) {
          throw new Error("Connected PostgreSQL target is not the expected local database");
        }
      }).catch((error: unknown) => {
        this.verifiedTarget = undefined;
        throw error;
      });
    }
    await this.verifiedTarget;
  }

  public async initializeSchema(): Promise<void> {
    await this.pool.query(getAutoSeoPostgresSchemaSql(this.schema));
  }

  private async insertWithClient(client: PoolClient, record: AutoSeoPostgresBackupInput, onConflict: "error" | "update"): Promise<void> {
    const conflictSql = onConflict === "update" ? `
      ON CONFLICT (workflow_id, store_id, product_id) DO UPDATE SET
        backup_id = EXCLUDED.backup_id,
        shop_domain = EXCLUDED.shop_domain,
        product_handle = EXCLUDED.product_handle,
        product_title = EXCLUDED.product_title,
        shopify_updated_at = EXCLUDED.shopify_updated_at,
        snapshot_json = EXCLUDED.snapshot_json,
        snapshot_sha256 = EXCLUDED.snapshot_sha256,
        seo_input_sha256 = EXCLUDED.seo_input_sha256,
        gpt_settings_json = NULL,
        downstream_status = 'NOT_SENT',
        downstream_http_status = NULL,
        downstream_error = NULL,
        downstream_sent_at = NULL,
        created_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ` : "";
    await client.query(`
      INSERT INTO ${this.schema}.auto_seo_product_backups (
        backup_id, workflow_id, store_id, shop_domain, product_id,
        product_handle, product_title, shopify_updated_at, snapshot_json,
        snapshot_sha256, seo_input_sha256, downstream_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'NOT_SENT')
      ${conflictSql}
    `, [
      record.backupId,
      record.workflowId,
      record.storeId,
      record.shopDomain,
      record.productId,
      record.productHandle,
      record.productTitle,
      record.shopifyUpdatedAt ?? null,
      record.snapshotJson,
      record.snapshotSha256,
      record.seoInputSha256 ?? null,
    ]);
  }

  public async claimEligibleBatch(
    records: readonly AutoSeoPostgresBackupInput[],
    options?: AutoSeoPostgresInsertOptions,
  ): Promise<AutoSeoPostgresClaimResult> {
    if (records.length === 0) return { acceptedRecords: [], skippedProducts: [] };
    const first = records[0];
    if (options?.gptSettingsJson !== undefined && first && records.some((record) => record.workflowId !== first.workflowId || record.storeId !== first.storeId)) {
      throw new Error("Custom GPT settings require one workflow and store per backup batch");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const acceptedRecords: AutoSeoPostgresBackupInput[] = [];
      const skippedProducts: AutoSeoPostgresClaimResult["skippedProducts"][number][] = [];
      const orderedRecords = [...records].sort((left, right) =>
        `${left.storeId}\0${left.productId}`.localeCompare(`${right.storeId}\0${right.productId}`),
      );

      for (const record of orderedRecords) {
        if (!record.seoInputSha256) {
          throw new Error(`AUTO_SEO_INPUT_HASH_REQUIRED: ${record.productId}`);
        }
        const lockKey = `${record.storeId}\0${record.productId}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
        const matching = await client.query<{
          downstream_status: "NOT_SENT" | "SENT" | "FAILED";
          workflow_id: string;
        }>(`
          SELECT downstream_status, workflow_id
          FROM ${this.schema}.auto_seo_product_backups
          WHERE store_id=$1 AND product_id=$2 AND seo_input_sha256=$3
          ORDER BY CASE downstream_status WHEN 'NOT_SENT' THEN 0 WHEN 'SENT' THEN 1 ELSE 2 END, id DESC
          LIMIT 1
          FOR UPDATE
        `, [record.storeId, record.productId, record.seoInputSha256]);
        const matchingRecord = matching.rows[0];
        const status = matchingRecord?.downstream_status;
        if (status === "NOT_SENT") {
          skippedProducts.push({ productId: record.productId, reason: "ACTIVE_DUPLICATE" });
          continue;
        }
        if (status === "SENT") {
          skippedProducts.push({ productId: record.productId, reason: "UNCHANGED" });
          continue;
        }
        const onConflict = status === "FAILED" && matchingRecord.workflow_id === record.workflowId
          ? "update"
          : options?.onConflict ?? "error";
        await this.insertWithClient(client, record, onConflict);
        acceptedRecords.push(record);
      }

      if (options?.gptSettingsJson !== undefined && first && acceptedRecords.length > 0) {
        await client.query(
          `UPDATE ${this.schema}.auto_seo_product_backups SET gpt_settings_json=$1 WHERE workflow_id=$2 AND store_id=$3 AND backup_id=ANY($4::text[])`,
          [options.gptSettingsJson, first.workflowId, first.storeId, acceptedRecords.map(record => record.backupId)],
        );
      }
      await client.query("COMMIT");
      return { acceptedRecords, skippedProducts };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async insertBackup(record: AutoSeoPostgresBackupInput, options?: AutoSeoPostgresInsertOptions): Promise<void> {
    await this.insertBackupBatch([record], options);
  }

  public async insertBackupBatch(records: readonly AutoSeoPostgresBackupInput[], options?: AutoSeoPostgresInsertOptions): Promise<void> {
    if (records.length === 0) return;
    const first = records[0];
    if (options?.gptSettingsJson !== undefined && first && records.some((record) => record.workflowId !== first.workflowId || record.storeId !== first.storeId)) {
      throw new Error("Custom GPT settings require one workflow and store per backup batch");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) await this.insertWithClient(client, record, options?.onConflict ?? "error");
      if (options?.gptSettingsJson !== undefined && first) {
        await client.query(
          `UPDATE ${this.schema}.auto_seo_product_backups SET gpt_settings_json=$1 WHERE workflow_id=$2 AND store_id=$3`,
          [options.gptSettingsJson, first.workflowId, first.storeId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async findByBackupId(backupId: string): Promise<AutoSeoPostgresBackup | null> {
    const { rows } = await this.pool.query<BackupRow>(
      `SELECT * FROM ${this.schema}.auto_seo_product_backups WHERE backup_id=$1`,
      [backupId],
    );
    return rows[0] ? mapBackup(rows[0]) : null;
  }

  public async findByStoreAndProductIds(
    storeId: string,
    productIds: readonly string[],
  ): Promise<readonly AutoSeoPostgresBackup[]> {
    if (productIds.length === 0) return [];
    const { rows } = await this.pool.query<BackupRow>(`
      SELECT * FROM ${this.schema}.auto_seo_product_backups
      WHERE store_id=$1 AND product_id=ANY($2::text[])
      ORDER BY replace(created_at, ' ', 'T')::timestamp DESC, id DESC
    `, [storeId, productIds]);
    return rows.map(mapBackup);
  }

  public async countByWorkflow(workflowId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${this.schema}.auto_seo_product_backups WHERE workflow_id=$1`,
      [workflowId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  public async findPendingBackups(limit = 10): Promise<readonly AutoSeoPostgresBackup[]> {
    const { rows } = await this.pool.query<BackupRow>(
      `SELECT * FROM ${this.schema}.auto_seo_product_backups WHERE downstream_status='NOT_SENT' AND gpt_settings_json IS NOT NULL ORDER BY replace(created_at, ' ', 'T')::timestamp, id LIMIT $1`,
      [limit],
    );
    return rows.map(mapBackup);
  }

  public async updateDownstreamStatus(
    workflowId: string,
    backupIds: readonly string[],
    status: "SENT" | "FAILED",
    httpStatus?: number | null,
    error?: string | null,
  ): Promise<void> {
    if (backupIds.length === 0) return;
    await this.pool.query(`
      UPDATE ${this.schema}.auto_seo_product_backups
      SET downstream_status=$1, downstream_http_status=$2, downstream_error=$3, downstream_sent_at=$4
      WHERE workflow_id=$5 AND backup_id=ANY($6::text[])
    `, [status, httpStatus ?? null, error ? error.slice(0, 1000) : null, new Date().toISOString(), workflowId, backupIds]);
  }

  public async acknowledgePendingHandoff(backupId: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.schema}.auto_seo_product_backups SET downstream_status='SENT', downstream_sent_at=$1 WHERE backup_id=$2 AND downstream_status='NOT_SENT'`, [new Date().toISOString(), backupId]);
  }

  public async failPendingHandoff(backupId: string, error: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.schema}.auto_seo_product_backups SET downstream_status='FAILED', downstream_error=$1 WHERE backup_id=$2`, [error, backupId]);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

let runtimeRepository: AutoSeoPostgresRepository | undefined;

export function getAutoSeoBackupRepository(): AutoSeoPostgresRepository {
  if (runtimeRepository) return runtimeRepository;
  const databaseUrl = process.env.AUTO_SEO_DATABASE_URL ?? loadLocalEnv().AUTO_SEO_DATABASE_URL;
  if (!databaseUrl) throw new Error("AUTO_SEO_DATABASE_URL is required for Auto SEO backups");
  runtimeRepository = new AutoSeoPostgresRepository({ databaseUrl });
  return runtimeRepository;
}
