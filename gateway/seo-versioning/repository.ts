import { randomUUID } from "node:crypto";

import type { WorkerDatabase, WorkerSql } from "../seo-worker/database";

import {
  SEO_FIELD_SET_VERSION,
  SEO_SNAPSHOT_SCHEMA_VERSION,
  type CommitVersionInput,
  type EnsureBaselineInput,
  type ObserveExternalChangeInput,
  type RecordDraftBaseInput,
  type SeoBaselineResult,
  type SeoCommitResult,
  type SeoContentSnapshotInput,
  type SeoDraftPublishContext,
  type SeoExternalChangeResult,
  type SeoProductLifecycle,
  type SeoRollbackDraftRequest,
  type SeoSnapshotSource,
  type SeoStoreVersioningFlags,
  type SeoVersionPage,
  type SeoVersionRecord,
  type SeoVersionSnapshot,
} from "./domain";

function prefix(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid SEO versioning schema");
  return `"${schema}".`;
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function validateHash(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("INVALID_CONTENT_HASH");
  return hash;
}

function versionFromRow(row: Record<string, unknown>): SeoVersionRecord {
  return {
    id: String(row.id), storeId: String(row.store_id), productId: String(row.product_id),
    versionNumber: Number(row.version_number), snapshotId: String(row.snapshot_id),
    beforeSnapshotId: row.before_snapshot_id === null ? null : String(row.before_snapshot_id),
    predecessorVersionId: row.predecessor_version_id === null ? null : String(row.predecessor_version_id),
    source: String(row.source) as SeoVersionRecord["source"],
    publishOperationId: row.publish_operation_id === null ? null : String(row.publish_operation_id),
    restoredFromVersionId: row.restored_from_version_id === null ? null : String(row.restored_from_version_id),
    appliedAt: Number(row.applied_at_utc),
    publicEffectiveAt: row.public_effective_at_utc === null ? null : Number(row.public_effective_at_utc),
  };
}

function jsonRecord(value: unknown): Readonly<Record<string, string | null>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Readonly<Record<string, string | null>>;
}

function jsonArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value as readonly T[] : [];
}

function snapshotFromRow(row: Record<string, unknown>): SeoContentSnapshotInput {
  return {
    contentHash: String(row.content_hash), title: String(row.title), descriptionHtml: String(row.description_html),
    seoTitle: row.seo_title === null ? null : String(row.seo_title),
    seoDescription: row.seo_description === null ? null : String(row.seo_description),
    images: jsonArray(row.images), aeoMetafields: jsonRecord(row.aeo_metafields), handle: String(row.handle),
    onlineStoreUrl: row.online_store_url === null ? null : String(row.online_store_url),
    observedCanonicalUrl: row.observed_canonical_url === null ? null : String(row.observed_canonical_url),
    shopifyStatus: String(row.shopify_status), vendor: row.vendor === null ? null : String(row.vendor),
    productType: row.product_type === null ? null : String(row.product_type), tags: jsonArray<string>(row.tags),
    extensionFields: row.extension_fields && typeof row.extension_fields === "object" && !Array.isArray(row.extension_fields)
      ? row.extension_fields as Readonly<Record<string, unknown>> : {},
  };
}

function rollbackRequestFromRow(row: Record<string, unknown>): SeoRollbackDraftRequest {
  return {
    id: String(row.id), requestId: String(row.request_id), storeId: String(row.store_id),
    shopifyProductGid: String(row.shopify_product_gid), basedOnVersionId: String(row.based_on_version_id),
    basedOnSnapshotId: String(row.based_on_snapshot_id), basedOnContentHash: String(row.based_on_content_hash),
    restoredFromVersionId: String(row.restored_from_version_id), restoredFromSnapshotId: String(row.restored_from_snapshot_id),
    status: "REQUESTED", requestedBy: String(row.requested_by), createdAt: Number(row.created_at),
  };
}

export class SeoVersionRepository {
  private readonly p: string;

  constructor(private readonly database: WorkerDatabase, schema = "public", private readonly id: () => string = randomUUID) {
    this.p = prefix(schema);
  }

  async setStoreFlags(flags: SeoStoreVersioningFlags, updatedAt: number): Promise<void> {
    if (flags.writeEnabled && !flags.readEnabled) throw new Error("SEO_VERSION_READ_REQUIRED");
    await this.database.transaction(async sql => {
      await sql.query(`INSERT INTO ${this.p}seo_version_store_settings(store_id,read_enabled,write_enabled,updated_at)
        VALUES ($1,$2,$3,$4) ON CONFLICT(store_id) DO UPDATE SET
        read_enabled=EXCLUDED.read_enabled,write_enabled=EXCLUDED.write_enabled,updated_at=EXCLUDED.updated_at`,
      [required(flags.storeId, "STORE_ID_REQUIRED"), flags.readEnabled, flags.writeEnabled, updatedAt]);
    });
  }

  async getStoreFlags(storeId: string): Promise<SeoStoreVersioningFlags> {
    return this.database.transaction(async sql => {
      const rows = await sql.query(`SELECT * FROM ${this.p}seo_version_store_settings WHERE store_id=$1`, [storeId]);
      const row = rows.rows[0];
      return row ? { storeId: String(row.store_id), readEnabled: Boolean(row.read_enabled), writeEnabled: Boolean(row.write_enabled) }
        : { storeId, readEnabled: false, writeEnabled: false };
    });
  }

  async ensureBaseline(input: EnsureBaselineInput): Promise<SeoBaselineResult> {
    this.validateSnapshot(input.snapshot);
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, input.storeId, "read_enabled");
      const productId = this.id();
      await sql.query(`INSERT INTO ${this.p}seo_products(id,store_id,shopify_product_gid,current_url,shopify_status,first_seen_at,last_seen_at,versioning_state)
        VALUES ($1,$2,$3,$4,$5,$6,$6,$7) ON CONFLICT(store_id,shopify_product_gid) DO NOTHING`,
      [productId, input.storeId, input.shopifyProductGid, input.snapshot.onlineStoreUrl, input.snapshot.shopifyStatus, input.observedAt, this.state(input.snapshot.shopifyStatus)]);
      const product = await this.lockProduct(sql, input.storeId, input.shopifyProductGid);
      if (product.current_version_id !== null) {
        return { created: false, version: await this.getVersionById(sql, input.storeId, String(product.current_version_id)) };
      }
      const snapshotId = this.id();
      await this.insertSnapshot(sql, snapshotId, input.storeId, String(product.id), input.snapshot, "BASELINE", input.observedAt);
      const versionId = this.id();
      await sql.query(`INSERT INTO ${this.p}seo_versions(id,store_id,product_id,version_number,snapshot_id,source,applied_at_utc,created_at_utc)
        VALUES ($1,$2,$3,0,$4,'BASELINE',$5,$5)`, [versionId, input.storeId, product.id, snapshotId, input.observedAt]);
      await sql.query(`UPDATE ${this.p}seo_products SET current_version_id=$1,current_observed_snapshot_id=$2,current_url=$3,
        shopify_status=$4,last_seen_at=$5,versioning_state=$6 WHERE id=$7`,
      [versionId, snapshotId, input.snapshot.onlineStoreUrl, input.snapshot.shopifyStatus, input.observedAt, this.state(input.snapshot.shopifyStatus), product.id]);
      await this.recordUrlObservation(sql, input.storeId, String(product.id), input.snapshot, input.observedAt);
      await this.audit(sql, input.storeId, String(product.id), "BASELINE_CREATED", versionId, { contentHash: input.snapshot.contentHash }, input.observedAt);
      return { created: true, version: await this.getVersionById(sql, input.storeId, versionId) };
    });
  }

  async commitVersion(input: CommitVersionInput): Promise<SeoCommitResult> {
    this.validateSnapshot(input.snapshot);
    return this.database.transaction(sql => this.commitVersionInTransaction(sql, input));
  }

  async commitVersionInTransaction(sql: WorkerSql, input: CommitVersionInput): Promise<SeoCommitResult> {
    this.validateSnapshot(input.snapshot);
      await this.assertEnabled(sql, input.storeId, "write_enabled");
      const product = await this.lockProduct(sql, input.storeId, input.shopifyProductGid);
      const receipt = (await sql.query(`SELECT * FROM ${this.p}seo_version_operation_receipts WHERE operation_id=$1`, [input.operationId])).rows[0];
      if (receipt) {
        if (receipt.store_id !== input.storeId || receipt.product_id !== product.id || receipt.content_hash !== input.snapshot.contentHash) {
          throw new Error("VERSION_OPERATION_CONFLICT");
        }
        return {
          outcome: String(receipt.outcome) as SeoCommitResult["outcome"],
          version: await this.getVersionById(sql, input.storeId, String(receipt.version_id)),
        };
      }
      const currentVersionId = String(product.current_version_id);
      const current = await this.getVersionById(sql, input.storeId, currentVersionId);
      const snapshotRow = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots WHERE id=$1 AND store_id=$2`, [current.snapshotId, input.storeId])).rows[0];
      if (current.id !== input.expectedVersionId || String(snapshotRow?.content_hash) !== input.expectedContentHash) throw new Error("CONTENT_CONFLICT");
      const observedRow = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots WHERE id=$1 AND store_id=$2`,
        [product.current_observed_snapshot_id, input.storeId])).rows[0];
      if (String(observedRow?.content_hash) !== input.expectedContentHash) throw new Error("CONTENT_CONFLICT");
      if (input.source === "ROLLBACK" && !input.restoredFromVersionId) throw new Error("ROLLBACK_SOURCE_REQUIRED");
      if (input.source !== "ROLLBACK" && input.restoredFromVersionId) throw new Error("ROLLBACK_SOURCE_FORBIDDEN");
      if (input.restoredFromVersionId) await this.getVersionById(sql, input.storeId, input.restoredFromVersionId);
      if (input.snapshot.contentHash === input.expectedContentHash) {
        await this.insertReceipt(sql, input.operationId, input.storeId, String(product.id), "NO_CHANGE", current.id,
          input.snapshot.contentHash, input.appliedAt);
        await this.audit(sql, input.storeId, String(product.id), "NO_CHANGE", input.operationId, {}, input.appliedAt);
        return { outcome: "NO_CHANGE", version: current };
      }
      const snapshotId = this.id();
      await this.insertSnapshot(sql, snapshotId, input.storeId, String(product.id), input.snapshot, "AFTER_PUBLISH", input.appliedAt);
      const versionId = this.id();
      await sql.query(`INSERT INTO ${this.p}seo_versions(id,store_id,product_id,version_number,snapshot_id,before_snapshot_id,
        predecessor_version_id,source,publish_operation_id,restored_from_version_id,approved_by,applied_by,model_id,prompt_versions,
        pipeline_version,store_profile_version,batch_id,job_id,applied_at_utc,public_effective_at_utc,created_at_utc)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$19)`,
      [versionId, input.storeId, product.id, current.versionNumber + 1, snapshotId, current.snapshotId, current.id, input.source,
        input.operationId, input.restoredFromVersionId ?? null, input.approvedBy, input.appliedBy, input.modelId ?? null,
        JSON.stringify(input.promptVersions ?? {}), input.pipelineVersion ?? null, input.storeProfileVersion ?? null,
        input.batchId ?? null, input.jobId ?? null, input.appliedAt, input.publicEffectiveAt ?? null]);
      await sql.query(`UPDATE ${this.p}seo_products SET current_version_id=$1,current_observed_snapshot_id=$2,current_url=$3,
        shopify_status=$4,last_seen_at=$5,versioning_state=$6 WHERE id=$7`,
      [versionId, snapshotId, input.snapshot.onlineStoreUrl, input.snapshot.shopifyStatus, input.appliedAt, this.state(input.snapshot.shopifyStatus), product.id]);
      await this.recordUrlObservation(sql, input.storeId, String(product.id), input.snapshot, input.appliedAt);
      await this.insertReceipt(sql, input.operationId, input.storeId, String(product.id), "COMMITTED", versionId,
        input.snapshot.contentHash, input.appliedAt);
      await this.audit(sql, input.storeId, String(product.id), "VERSION_COMMITTED", versionId, { operationId: input.operationId }, input.appliedAt);
      return { outcome: "COMMITTED", version: await this.getVersionById(sql, input.storeId, versionId) };
  }

  async resolveDraftPublishContext(sql: WorkerSql, storeId: string, jobId: string,
    shopifyProductGid: string): Promise<SeoDraftPublishContext | null> {
    const flags = (await sql.query(`SELECT read_enabled,write_enabled FROM ${this.p}seo_version_store_settings WHERE store_id=$1`, [storeId])).rows[0];
    if (!flags || flags.write_enabled !== true) return null;
    if (flags.read_enabled !== true) throw new Error("SEO_VERSION_READ_REQUIRED");
    const row = (await sql.query(`SELECT d.based_on_version_id,d.based_on_snapshot_id,d.based_on_content_hash,v.version_number
      FROM ${this.p}seo_draft_bases d
      JOIN ${this.p}seo_products p ON p.store_id=d.store_id AND p.id=d.product_id
      JOIN ${this.p}seo_versions v ON v.store_id=d.store_id AND v.product_id=d.product_id AND v.id=d.based_on_version_id
      WHERE d.store_id=$1 AND d.job_id=$2 AND p.shopify_product_gid=$3`, [storeId, jobId, shopifyProductGid])).rows[0];
    if (!row) throw new Error("SEO_DRAFT_BASE_REQUIRED");
    return {
      versionId: String(row.based_on_version_id),
      snapshotId: String(row.based_on_snapshot_id),
      contentHash: String(row.based_on_content_hash),
      versionNumber: Number(row.version_number),
    };
  }

  async recordDraftBase(input: RecordDraftBaseInput): Promise<void> {
    await this.database.transaction(async sql => {
      await this.assertEnabled(sql, input.storeId, "read_enabled");
      const product = await this.lockProduct(sql, input.storeId, input.shopifyProductGid);
      if (product.current_version_id === null || product.current_observed_snapshot_id === null) throw new Error("SEO_BASELINE_REQUIRED");
      const version = await this.getVersionById(sql, input.storeId, String(product.current_version_id));
      const snapshot = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots WHERE id=$1`, [version.snapshotId])).rows[0];
      await sql.query(`INSERT INTO ${this.p}seo_draft_bases(job_id,store_id,product_id,based_on_version_id,based_on_snapshot_id,
        based_on_content_hash,input_contract_version,store_profile_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(job_id) DO NOTHING`, [input.jobId, input.storeId, product.id, product.current_version_id,
        version.snapshotId, snapshot?.content_hash, input.inputContractVersion, input.storeProfileVersion, input.createdAt]);
      const recorded = (await sql.query(`SELECT store_id,product_id,based_on_version_id,based_on_snapshot_id,based_on_content_hash,
        input_contract_version,store_profile_version FROM ${this.p}seo_draft_bases WHERE job_id=$1`, [input.jobId])).rows[0];
      if (recorded?.store_id !== input.storeId || recorded?.product_id !== product.id
        || recorded?.based_on_version_id !== version.id || recorded?.based_on_snapshot_id !== version.snapshotId
        || recorded?.based_on_content_hash !== snapshot?.content_hash || recorded?.input_contract_version !== input.inputContractVersion
        || recorded?.store_profile_version !== input.storeProfileVersion) throw new Error("DRAFT_BASE_CONFLICT");
    });
  }

  async observeExternalChange(input: ObserveExternalChangeInput): Promise<SeoExternalChangeResult> {
    this.validateSnapshot(input.snapshot);
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, input.storeId, "read_enabled");
      const product = await this.lockProduct(sql, input.storeId, input.shopifyProductGid);
      if (product.current_version_id === null || product.current_observed_snapshot_id === null) throw new Error("SEO_BASELINE_REQUIRED");
      const previous = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots WHERE id=$1`, [product.current_observed_snapshot_id])).rows[0];
      if (previous?.content_hash === input.snapshot.contentHash) {
        const nextState = product.versioning_state === "DIRTY" ? "DIRTY" : this.state(input.snapshot.shopifyStatus);
        await sql.query(`UPDATE ${this.p}seo_products SET current_url=$1,shopify_status=$2,last_seen_at=$3,versioning_state=$4 WHERE id=$5`,
          [input.snapshot.onlineStoreUrl, input.snapshot.shopifyStatus, input.observedAt, nextState, product.id]);
        await this.recordUrlObservation(sql, input.storeId, String(product.id), input.snapshot, input.observedAt);
        return { changed: false, externalChangeId: null };
      }
      const snapshotId = this.id();
      await this.insertSnapshot(sql, snapshotId, input.storeId, String(product.id), input.snapshot, "EXTERNAL_OBSERVATION", input.observedAt);
      const externalChangeId = this.id();
      await sql.query(`INSERT INTO ${this.p}seo_external_changes(id,store_id,product_id,committed_version_id,previous_observed_snapshot_id,
        observed_snapshot_id,observed_at,changed_fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [externalChangeId, input.storeId, product.id, product.current_version_id, product.current_observed_snapshot_id,
        snapshotId, input.observedAt, JSON.stringify(input.changedFields)]);
      await sql.query(`UPDATE ${this.p}seo_products SET current_observed_snapshot_id=$1,current_url=$2,shopify_status=$3,
        last_seen_at=$4,versioning_state='DIRTY' WHERE id=$5`,
      [snapshotId, input.snapshot.onlineStoreUrl, input.snapshot.shopifyStatus, input.observedAt, product.id]);
      await this.recordUrlObservation(sql, input.storeId, String(product.id), input.snapshot, input.observedAt);
      await this.audit(sql, input.storeId, String(product.id), "EXTERNAL_CHANGE_OBSERVED", externalChangeId,
        { changedFields: input.changedFields }, input.observedAt);
      return { changed: true, externalChangeId };
    });
  }

  async listVersions(storeId: string, shopifyProductGid: string): Promise<readonly SeoVersionRecord[]> {
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, storeId, "read_enabled");
      const product = await this.lockProduct(sql, storeId, shopifyProductGid);
      const rows = await sql.query(`SELECT * FROM ${this.p}seo_versions WHERE store_id=$1 AND product_id=$2 ORDER BY version_number`, [storeId, product.id]);
      return rows.rows.map(versionFromRow);
    });
  }

  async getProductLifecycle(storeId: string, shopifyProductGid: string): Promise<SeoProductLifecycle> {
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, storeId, "read_enabled");
      const product = await this.findProduct(sql, storeId, shopifyProductGid);
      if (product.current_version_id === null || product.current_observed_snapshot_id === null) throw new Error("SEO_BASELINE_REQUIRED");
      const currentVersion = await this.getVersionById(sql, storeId, String(product.current_version_id));
      const snapshot = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots
        WHERE store_id=$1 AND product_id=$2 AND id=$3`, [storeId, product.id, product.current_observed_snapshot_id])).rows[0];
      if (!snapshot) throw new Error("SEO_SNAPSHOT_NOT_FOUND");
      const external = (await sql.query(`SELECT 1 FROM ${this.p}seo_external_changes
        WHERE store_id=$1 AND product_id=$2 AND resolved_at IS NULL LIMIT 1`, [storeId, product.id])).rows[0];
      return {
        storeId, shopifyProductGid, currentVersion, currentSnapshotId: String(product.current_observed_snapshot_id),
        currentContentHash: String(snapshot.content_hash), state: String(product.versioning_state) as SeoProductLifecycle["state"],
        shopifyStatus: String(product.shopify_status), currentUrl: product.current_url === null ? null : String(product.current_url),
        lastSeenAt: Number(product.last_seen_at), hasExternalChanges: Boolean(external),
      };
    });
  }

  async listVersionPage(storeId: string, shopifyProductGid: string, limit: number, offset: number): Promise<SeoVersionPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error("INVALID_PAGINATION");
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, storeId, "read_enabled");
      const product = await this.findProduct(sql, storeId, shopifyProductGid);
      const total = Number((await sql.query(`SELECT count(*)::int AS total FROM ${this.p}seo_versions
        WHERE store_id=$1 AND product_id=$2`, [storeId, product.id])).rows[0]?.total ?? 0);
      const rows = await sql.query(`SELECT * FROM ${this.p}seo_versions WHERE store_id=$1 AND product_id=$2
        ORDER BY version_number DESC LIMIT $3 OFFSET $4`, [storeId, product.id, limit, offset]);
      const nextOffset = offset + rows.rows.length < total ? offset + rows.rows.length : null;
      return { entries: rows.rows.map(versionFromRow), total, nextOffset };
    });
  }

  async getVersionSnapshot(storeId: string, shopifyProductGid: string, versionId: string): Promise<SeoVersionSnapshot> {
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, storeId, "read_enabled");
      const product = await this.findProduct(sql, storeId, shopifyProductGid);
      const row = (await sql.query(`SELECT v.*,s.content_hash,s.title,s.description_html,s.seo_title,s.seo_description,
        s.images,s.aeo_metafields,s.handle,s.online_store_url,s.observed_canonical_url,s.shopify_status,s.vendor,
        s.product_type,s.tags,s.extension_fields FROM ${this.p}seo_versions v
        JOIN ${this.p}seo_content_snapshots s ON s.store_id=v.store_id AND s.product_id=v.product_id AND s.id=v.snapshot_id
        WHERE v.store_id=$1 AND v.product_id=$2 AND v.id=$3`, [storeId, product.id, versionId])).rows[0];
      if (!row) throw new Error("SEO_VERSION_NOT_FOUND");
      return { version: versionFromRow(row), snapshot: snapshotFromRow(row) };
    });
  }

  async requestRollbackDraft(input: { readonly storeId: string; readonly shopifyProductGid: string; readonly targetVersionId: string;
    readonly requestId: string; readonly requestedBy: string; readonly createdAt: number }): Promise<SeoRollbackDraftRequest> {
    return this.database.transaction(async sql => {
      await this.assertEnabled(sql, input.storeId, "write_enabled");
      const product = await this.lockProduct(sql, input.storeId, input.shopifyProductGid);
      if (product.current_version_id === null || product.current_observed_snapshot_id === null) throw new Error("SEO_BASELINE_REQUIRED");
      if (product.versioning_state === "DIRTY") throw new Error("SEO_PRODUCT_DIRTY");
      const current = await this.getVersionById(sql, input.storeId, String(product.current_version_id));
      const target = await this.getVersionById(sql, input.storeId, input.targetVersionId);
      if (target.productId !== String(product.id)) throw new Error("SEO_VERSION_NOT_FOUND");
      if (target.id === current.id) throw new Error("ROLLBACK_TARGET_CURRENT");
      const currentSnapshot = (await sql.query(`SELECT content_hash FROM ${this.p}seo_content_snapshots
        WHERE store_id=$1 AND product_id=$2 AND id=$3`, [input.storeId, product.id, current.snapshotId])).rows[0];
      const id = this.id();
      await sql.query(`INSERT INTO ${this.p}seo_rollback_draft_requests(id,request_id,store_id,product_id,based_on_version_id,
        based_on_snapshot_id,based_on_content_hash,restored_from_version_id,restored_from_snapshot_id,status,requested_by,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'REQUESTED',$10,$11) ON CONFLICT(store_id,request_id) DO NOTHING`,
      [id, input.requestId, input.storeId, product.id, current.id, current.snapshotId, currentSnapshot?.content_hash,
        target.id, target.snapshotId, input.requestedBy, input.createdAt]);
      const row = (await sql.query(`SELECT r.*,p.shopify_product_gid FROM ${this.p}seo_rollback_draft_requests r
        JOIN ${this.p}seo_products p ON p.store_id=r.store_id AND p.id=r.product_id
        WHERE r.store_id=$1 AND r.request_id=$2`, [input.storeId, input.requestId])).rows[0];
      if (!row || row.product_id !== product.id || row.restored_from_version_id !== target.id) throw new Error("ROLLBACK_REQUEST_CONFLICT");
      return rollbackRequestFromRow(row);
    });
  }

  private async assertEnabled(sql: WorkerSql, storeId: string, column: "read_enabled" | "write_enabled"): Promise<void> {
    const row = (await sql.query(`SELECT ${column} FROM ${this.p}seo_version_store_settings WHERE store_id=$1`, [storeId])).rows[0];
    if (!row || row[column] !== true) throw new Error(column === "read_enabled" ? "SEO_VERSION_READ_DISABLED" : "SEO_VERSION_WRITE_DISABLED");
  }

  private async lockProduct(sql: WorkerSql, storeId: string, shopifyProductGid: string): Promise<Record<string, unknown>> {
    const row = (await sql.query(`SELECT * FROM ${this.p}seo_products WHERE store_id=$1 AND shopify_product_gid=$2 FOR UPDATE`, [storeId, shopifyProductGid])).rows[0];
    if (!row) throw new Error("SEO_PRODUCT_NOT_FOUND");
    return row;
  }

  private async findProduct(sql: WorkerSql, storeId: string, shopifyProductGid: string): Promise<Record<string, unknown>> {
    const row = (await sql.query(`SELECT * FROM ${this.p}seo_products WHERE store_id=$1 AND shopify_product_gid=$2`, [storeId, shopifyProductGid])).rows[0];
    if (!row) throw new Error("SEO_PRODUCT_NOT_FOUND");
    return row;
  }

  private async getVersionById(sql: WorkerSql, storeId: string, versionId: string): Promise<SeoVersionRecord> {
    const row = (await sql.query(`SELECT * FROM ${this.p}seo_versions WHERE store_id=$1 AND id=$2`, [storeId, versionId])).rows[0];
    if (!row) throw new Error("SEO_VERSION_NOT_FOUND");
    return versionFromRow(row);
  }

  private async insertSnapshot(sql: WorkerSql, id: string, storeId: string, productId: string, snapshot: SeoContentSnapshotInput,
    source: SeoSnapshotSource, capturedAt: number): Promise<void> {
    await sql.query(`INSERT INTO ${this.p}seo_content_snapshots(id,store_id,product_id,captured_at_utc,source,snapshot_schema_version,
      field_set_version,content_hash,title,description_html,seo_title,seo_description,images,aeo_metafields,handle,online_store_url,
      observed_canonical_url,shopify_status,vendor,product_type,tags,extension_fields)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb)`,
    [id, storeId, productId, capturedAt, source, SEO_SNAPSHOT_SCHEMA_VERSION, SEO_FIELD_SET_VERSION, snapshot.contentHash,
      snapshot.title, snapshot.descriptionHtml, snapshot.seoTitle, snapshot.seoDescription, JSON.stringify(snapshot.images),
      JSON.stringify(snapshot.aeoMetafields), snapshot.handle, snapshot.onlineStoreUrl, snapshot.observedCanonicalUrl,
      snapshot.shopifyStatus, snapshot.vendor, snapshot.productType, JSON.stringify(snapshot.tags), JSON.stringify(snapshot.extensionFields ?? {})]);
  }

  private async audit(sql: WorkerSql, storeId: string, productId: string, eventType: string, referenceId: string,
    payload: Readonly<Record<string, unknown>>, createdAt: number): Promise<void> {
    await sql.query(`INSERT INTO ${this.p}seo_version_audit(id,store_id,product_id,event_type,reference_id,payload,created_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [this.id(), storeId, productId, eventType, referenceId, JSON.stringify(payload), createdAt]);
  }

  private async insertReceipt(sql: WorkerSql, operationId: string, storeId: string, productId: string,
    outcome: "COMMITTED" | "NO_CHANGE", versionId: string, contentHash: string, createdAt: number): Promise<void> {
    await sql.query(`INSERT INTO ${this.p}seo_version_operation_receipts(operation_id,store_id,product_id,outcome,version_id,content_hash,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [operationId, storeId, productId, outcome, versionId, contentHash, createdAt]);
  }

  private async recordUrlObservation(sql: WorkerSql, storeId: string, productId: string, snapshot: SeoContentSnapshotInput,
    observedAt: number): Promise<void> {
    if (snapshot.onlineStoreUrl === null) return;
    const normalizedUrl = this.normalizeUrl(snapshot.onlineStoreUrl);
    const open = (await sql.query(`SELECT id,normalized_url,canonical_url FROM ${this.p}seo_product_url_history
      WHERE store_id=$1 AND product_id=$2 AND valid_to IS NULL FOR UPDATE`, [storeId, productId])).rows[0];
    const canonicalUrl = snapshot.observedCanonicalUrl === null ? null : this.normalizeUrl(snapshot.observedCanonicalUrl);
    if (open?.normalized_url === normalizedUrl && open?.canonical_url === canonicalUrl) return;
    if (open) await sql.query(`UPDATE ${this.p}seo_product_url_history SET valid_to=$1 WHERE id=$2`, [observedAt, open.id]);
    await sql.query(`INSERT INTO ${this.p}seo_product_url_history(id,store_id,product_id,raw_url,normalized_url,canonical_url,
      alias_type,mapping_evidence,valid_from) VALUES ($1,$2,$3,$4,$5,$6,'SHOPIFY_OBSERVED','{}'::jsonb,$7)`,
    [this.id(), storeId, productId, snapshot.onlineStoreUrl, normalizedUrl, canonicalUrl, observedAt]);
  }

  private validateSnapshot(snapshot: SeoContentSnapshotInput): void {
    validateHash(snapshot.contentHash);
    required(snapshot.handle, "SNAPSHOT_HANDLE_REQUIRED");
    const mediaGids = new Set<string>();
    for (const image of snapshot.images) {
      required(image.mediaGid, "SNAPSHOT_MEDIA_GID_REQUIRED");
      if (mediaGids.has(image.mediaGid)) throw new Error("DUPLICATE_SNAPSHOT_MEDIA_GID");
      mediaGids.add(image.mediaGid);
    }
  }

  private state(shopifyStatus: string): "ACTIVE" | "ARCHIVED" | "DELETED" {
    const normalized = shopifyStatus.toUpperCase();
    if (normalized === "ARCHIVED") return "ARCHIVED";
    return normalized === "DELETED" ? "DELETED" : "ACTIVE";
  }

  private normalizeUrl(value: string): string {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  }
}
