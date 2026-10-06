export type BenchmarkJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly BenchmarkJsonValue[]
  | { readonly [key: string]: BenchmarkJsonValue };

export interface BenchmarkSql {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
}

export interface BenchmarkVersionContext {
  readonly storeId: string;
  readonly productId: string;
  readonly shopifyProductGid: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly predecessorVersionId: string | null;
  readonly appliedAt: number;
  readonly publicEffectiveAt: number | null;
}

export interface SaveBenchmarkRunInput {
  readonly id: string;
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly versionId: string | null;
  readonly mode: "CALENDAR" | "VERSION";
  readonly checkpointDays: 7 | 14 | 28 | null;
  readonly rulesVersion: string;
  readonly metricContractVersion: string;
  readonly dataRevision: string;
  readonly filters: { readonly [key: string]: BenchmarkJsonValue };
  readonly beforeWindow: { readonly [key: string]: BenchmarkJsonValue } | null;
  readonly afterWindow: { readonly [key: string]: BenchmarkJsonValue } | null;
  readonly output: { readonly [key: string]: BenchmarkJsonValue };
}

export interface BenchmarkRunRecord extends SaveBenchmarkRunInput {
  readonly productId: string;
  readonly versionPublicEffectiveAt: number | null;
  readonly calculatedAt: string;
}

export interface BenchmarkRunPage {
  readonly items: readonly BenchmarkRunRecord[];
  readonly total: number;
  readonly nextOffset: number | null;
}

interface BenchmarkRunRow {
  readonly id: string;
  readonly store_id: string;
  readonly product_id: string;
  readonly shopify_product_gid: string;
  readonly version_id: string | null;
  readonly version_public_effective_at_utc: number | string | null;
  readonly mode: "CALENDAR" | "VERSION";
  readonly checkpoint_days: number | null;
  readonly rules_version: string;
  readonly metric_contract_version: string;
  readonly data_revision: string;
  readonly filters: BenchmarkRunRecord["filters"];
  readonly before_window: BenchmarkRunRecord["beforeWindow"];
  readonly after_window: BenchmarkRunRecord["afterWindow"];
  readonly output: BenchmarkRunRecord["output"];
  readonly calculated_at: Date | string;
}

const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

function requiredId(value: string, code: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) throw new Error(code);
  return normalized;
}

function productGid(value: string): string {
  if (!PRODUCT_GID_PATTERN.test(value)) throw new Error("INVALID_SHOPIFY_PRODUCT_GID");
  return value;
}

function stableJson(value: BenchmarkJsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("INVALID_BENCHMARK_JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as { readonly [key: string]: BenchmarkJsonValue };
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error("INVALID_SEO_VERSION_TIMESTAMP");
  }
  return normalized;
}

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_BENCHMARK_TIMESTAMP");
  return date.toISOString();
}

function runFromRow(row: BenchmarkRunRow): BenchmarkRunRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    shopifyProductGid: row.shopify_product_gid,
    versionId: row.version_id,
    versionPublicEffectiveAt: nullableNumber(row.version_public_effective_at_utc),
    mode: row.mode,
    checkpointDays: row.checkpoint_days as BenchmarkRunRecord["checkpointDays"],
    rulesVersion: row.rules_version,
    metricContractVersion: row.metric_contract_version,
    dataRevision: row.data_revision,
    filters: row.filters,
    beforeWindow: row.before_window,
    afterWindow: row.after_window,
    output: row.output,
    calculatedAt: isoTimestamp(row.calculated_at),
  };
}

function exactRunMatches(
  existing: BenchmarkRunRecord,
  input: SaveBenchmarkRunInput,
  productId: string,
): boolean {
  return existing.id === input.id &&
    existing.storeId === input.storeId &&
    existing.productId === productId &&
    existing.shopifyProductGid === input.shopifyProductGid &&
    existing.versionId === input.versionId &&
    existing.mode === input.mode &&
    existing.checkpointDays === input.checkpointDays &&
    existing.rulesVersion === input.rulesVersion &&
    existing.metricContractVersion === input.metricContractVersion &&
    existing.dataRevision === input.dataRevision &&
    stableJson(existing.filters) === stableJson(input.filters) &&
    stableJson(existing.beforeWindow) === stableJson(input.beforeWindow) &&
    stableJson(existing.afterWindow) === stableJson(input.afterWindow) &&
    stableJson(existing.output) === stableJson(input.output);
}

const RUN_SELECT = `SELECT run.*,product.shopify_product_gid,
  version.public_effective_at_utc AS version_public_effective_at_utc
  FROM sp_benchmark_runs AS run
  JOIN seo_products AS product
    ON product.store_id=run.store_id AND product.id=run.product_id
  LEFT JOIN seo_versions AS version
    ON version.store_id=run.store_id
   AND version.product_id=run.product_id
   AND version.id=run.version_id`;

export class BenchmarkStore {
  constructor(private readonly sql: BenchmarkSql) {}

  async versionContext(input: {
    readonly storeId: string;
    readonly shopifyProductGid: string;
    readonly versionId?: string;
  }): Promise<BenchmarkVersionContext | null> {
    const storeId = requiredId(input.storeId, "INVALID_STORE_ID");
    const gid = productGid(input.shopifyProductGid);
    const versionId = input.versionId
      ? requiredId(input.versionId, "INVALID_VERSION_ID")
      : null;
    const row = (await this.sql.query<{
      store_id: string;
      product_id: string;
      shopify_product_gid: string;
      version_id: string;
      version_number: number | string;
      predecessor_version_id: string | null;
      applied_at_utc: number | string;
      public_effective_at_utc: number | string | null;
    }>(`SELECT product.store_id,product.id AS product_id,product.shopify_product_gid,
        version.id AS version_id,version.version_number,version.predecessor_version_id,
        version.applied_at_utc,version.public_effective_at_utc
      FROM seo_products AS product
      JOIN seo_versions AS version
        ON version.store_id=product.store_id AND version.product_id=product.id
      WHERE product.store_id=$1
        AND product.shopify_product_gid=$2
        AND version.id=COALESCE($3,product.current_version_id)`,
    [storeId, gid, versionId])).rows[0];
    if (!row) return null;
    return {
      storeId: row.store_id,
      productId: row.product_id,
      shopifyProductGid: row.shopify_product_gid,
      versionId: row.version_id,
      versionNumber: Number(row.version_number),
      predecessorVersionId: row.predecessor_version_id,
      appliedAt: nullableNumber(row.applied_at_utc) ?? 0,
      publicEffectiveAt: nullableNumber(row.public_effective_at_utc),
    };
  }

  async saveRun(input: SaveBenchmarkRunInput): Promise<BenchmarkRunRecord> {
    const normalized = {
      ...input,
      id: requiredId(input.id, "INVALID_BENCHMARK_RUN_ID"),
      storeId: requiredId(input.storeId, "INVALID_STORE_ID"),
      shopifyProductGid: productGid(input.shopifyProductGid),
      rulesVersion: requiredId(input.rulesVersion, "INVALID_RULES_VERSION"),
      metricContractVersion: requiredId(
        input.metricContractVersion,
        "INVALID_METRIC_CONTRACT_VERSION",
      ),
      dataRevision: requiredId(input.dataRevision, "INVALID_DATA_REVISION"),
    };
    if ((normalized.mode === "VERSION") !== (normalized.versionId !== null)) {
      throw new Error("BENCHMARK_VERSION_MODE_MISMATCH");
    }
    if (normalized.mode === "VERSION" && normalized.checkpointDays === null) {
      throw new Error("BENCHMARK_CHECKPOINT_REQUIRED");
    }
    const context = normalized.versionId
      ? await this.versionContext({
        storeId: normalized.storeId,
        shopifyProductGid: normalized.shopifyProductGid,
        versionId: normalized.versionId,
      })
      : await this.currentProduct(normalized.storeId, normalized.shopifyProductGid);
    if (!context) throw new Error("SEO_VERSION_NOT_FOUND");

    await this.sql.query(
      `INSERT INTO sp_benchmark_runs(
        id,store_id,product_id,version_id,mode,checkpoint_days,rules_version,
        metric_contract_version,data_revision,filters,before_window,after_window,output
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb)
      ON CONFLICT DO NOTHING`,
      [
        normalized.id,
        normalized.storeId,
        context.productId,
        normalized.versionId,
        normalized.mode,
        normalized.checkpointDays,
        normalized.rulesVersion,
        normalized.metricContractVersion,
        normalized.dataRevision,
        stableJson(normalized.filters),
        normalized.beforeWindow === null ? null : stableJson(normalized.beforeWindow),
        normalized.afterWindow === null ? null : stableJson(normalized.afterWindow),
        stableJson(normalized.output),
      ],
    );
    const existing = await this.runById(normalized.id);
    if (!existing) throw new Error("BENCHMARK_RUN_SIGNATURE_COLLISION");
    if (!exactRunMatches(existing, normalized, context.productId)) {
      throw new Error("BENCHMARK_RUN_ID_COLLISION");
    }
    return existing;
  }

  async listLatestProductRuns(input: {
    readonly storeId: string;
    readonly shopifyProductGid: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<BenchmarkRunPage> {
    const storeId = requiredId(input.storeId, "INVALID_STORE_ID");
    const gid = productGid(input.shopifyProductGid);
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("INVALID_BENCHMARK_PAGINATION");
    }
    const product = await this.currentProduct(storeId, gid);
    if (!product) return { items: [], total: 0, nextOffset: null };
    const [rows, count] = await Promise.all([
      this.sql.query<BenchmarkRunRow>(`${RUN_SELECT}
        WHERE run.store_id=$1 AND run.product_id=$2
        ORDER BY run.calculated_at DESC,run.id DESC LIMIT $3 OFFSET $4`,
      [storeId, product.productId, limit, offset]),
      this.sql.query<{ count: number | string }>(
        "SELECT count(*) AS count FROM sp_benchmark_runs WHERE store_id=$1 AND product_id=$2",
        [storeId, product.productId],
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      items: rows.rows.map(runFromRow),
      total,
      nextOffset: offset + rows.rows.length < total ? offset + rows.rows.length : null,
    };
  }

  private async currentProduct(
    storeId: string,
    shopifyProductGid: string,
  ): Promise<BenchmarkVersionContext | null> {
    return this.versionContext({ storeId, shopifyProductGid });
  }

  private async runById(id: string): Promise<BenchmarkRunRecord | null> {
    const row = (await this.sql.query<BenchmarkRunRow>(
      `${RUN_SELECT} WHERE run.id=$1`,
      [id],
    )).rows[0];
    return row ? runFromRow(row) : null;
  }
}
