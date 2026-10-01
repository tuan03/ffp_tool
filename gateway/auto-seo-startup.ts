import { Pool } from "pg";

import { AutoSeoPostgresRepository } from "./auto-seo-postgres-repository";
import { AutoSeoPostgresReviewRepository } from "./auto-seo-review-postgres";
import { loadLocalEnv } from "./store-config-loader";

export interface AutoSeoStartupOptions {
  readonly databaseUrl?: string;
  readonly schema?: string;
}

export async function bootstrapAutoSeoSchema(options: AutoSeoStartupOptions = {}): Promise<void> {
  const databaseUrl = options.databaseUrl ?? process.env.AUTO_SEO_DATABASE_URL ?? loadLocalEnv().AUTO_SEO_DATABASE_URL;
  if (!databaseUrl) throw new Error("AUTO_SEO_DATABASE_URL is required for Auto SEO database initialization");

  const schema = options.schema ?? "public";
  const backupRepository = new AutoSeoPostgresRepository({ databaseUrl, schema });
  const reviewRepository = new AutoSeoPostgresReviewRepository({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await backupRepository.initializeSchema();
    await reviewRepository.initializeSchema();

    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])",
      [schema, ["auto_seo_product_backups", "seo_review_items"]],
    );
    const indexes = await pool.query<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      is_valid: boolean;
      definition: string;
    }>(
      `SELECT table_relation.relname AS table_name, index_relation.relname AS index_name,
              index_metadata.indisunique AS is_unique, index_metadata.indisvalid AS is_valid,
              pg_get_indexdef(index_metadata.indexrelid) AS definition
       FROM pg_index AS index_metadata
       JOIN pg_class AS table_relation ON table_relation.oid=index_metadata.indrelid
       JOIN pg_namespace AS table_namespace ON table_namespace.oid=table_relation.relnamespace
       JOIN pg_class AS index_relation ON index_relation.oid=index_metadata.indexrelid
       WHERE table_namespace.nspname=$1 AND table_relation.relname=ANY($2::text[])`,
      [schema, ["auto_seo_product_backups", "seo_review_items"]],
    );
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema=$1 AND table_name=ANY($2::text[])`,
      [schema, ["auto_seo_product_backups", "seo_review_items"]],
    );
    const constraints = await pool.query<{
      table_name: string;
      constraint_type: string;
      definition: string;
      referenced_schema: string | null;
      referenced_table: string | null;
    }>(
      `SELECT table_relation.relname AS table_name, constraint_metadata.contype AS constraint_type,
              pg_get_constraintdef(constraint_metadata.oid) AS definition,
              referenced_namespace.nspname AS referenced_schema,
              referenced_relation.relname AS referenced_table
       FROM pg_constraint AS constraint_metadata
       JOIN pg_class AS table_relation ON table_relation.oid=constraint_metadata.conrelid
       JOIN pg_namespace AS table_namespace ON table_namespace.oid=table_relation.relnamespace
       LEFT JOIN pg_class AS referenced_relation ON referenced_relation.oid=constraint_metadata.confrelid
       LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid=referenced_relation.relnamespace
       WHERE table_namespace.nspname=$1 AND table_relation.relname=ANY($2::text[])`,
      [schema, ["auto_seo_product_backups", "seo_review_items"]],
    );
    const requiredConstraints = [
      { table: "auto_seo_product_backups", type: "p", definition: "PRIMARY KEY (id)" },
      { table: "auto_seo_product_backups", type: "u", definition: "UNIQUE (backup_id)" },
      { table: "auto_seo_product_backups", type: "u", definition: "UNIQUE (workflow_id, store_id, product_id)" },
      { table: "auto_seo_product_backups", type: "c", definition: "downstream_status" },
      { table: "seo_review_items", type: "p", definition: "PRIMARY KEY (item_id)" },
      { table: "seo_review_items", type: "u", definition: "UNIQUE (store_id, product_id)" },
      { table: "seo_review_items", type: "c", definition: "review_status" },
      { table: "seo_review_items", type: "c", definition: "source_origin" },
    ];
    const requiredIndexes = [
      { table: "auto_seo_product_backups", name: "idx_auto_seo_store_product", columns: "(store_id, product_id)" },
      { table: "auto_seo_product_backups", name: "idx_auto_seo_created_at", columns: "(created_at)" },
      { table: "auto_seo_product_backups", name: "idx_auto_seo_store_product_input", columns: "(store_id, product_id, seo_input_sha256, downstream_status)" },
      { table: "seo_review_items", name: "idx_seo_review_store_status", columns: "(store_id, review_status, created_at DESC)" },
    ];
    const requiredColumns = [
      { table: "auto_seo_product_backups", column: "seo_input_sha256" },
      { table: "seo_review_items", column: "deleted_at" },
    ];
    const hasBackupReference = constraints.rows.some((constraint) =>
      constraint.table_name === "seo_review_items" &&
      constraint.constraint_type === "f" &&
      constraint.definition.startsWith("FOREIGN KEY (backup_id) REFERENCES ") &&
      constraint.definition.endsWith("(backup_id)") &&
      constraint.referenced_schema === schema &&
      constraint.referenced_table === "auto_seo_product_backups"
    );
    if (
      tables.rowCount !== 2 ||
      requiredColumns.some(({ table, column }) => !columns.rows.some((candidate) =>
        candidate.table_name === table && candidate.column_name === column
      )) ||
      requiredIndexes.some(({ table, name, columns }) => !indexes.rows.some((index) =>
        index.table_name === table && index.index_name === name &&
        index.definition.includes(columns) && !index.is_unique && index.is_valid
      )) ||
      requiredConstraints.some(({ table, type, definition }) => !constraints.rows.some((constraint) =>
        constraint.table_name === table && constraint.constraint_type === type && constraint.definition.includes(definition)
      )) ||
      !hasBackupReference
    ) {
      throw new Error("Auto SEO PostgreSQL schema verification failed");
    }
  } finally {
    await Promise.all([backupRepository.close(), reviewRepository.close(), pool.end()]);
  }
}
