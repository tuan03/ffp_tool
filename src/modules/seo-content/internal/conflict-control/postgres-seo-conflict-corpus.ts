import type { Pool, PoolClient } from "pg";

import { queryOne, queryRows, withSeoTransaction } from "../persistence/postgres";
import { checkContextualConflict } from "./contextual-conflict-evaluator";
import { cosineSimilarity } from "./cosine-similarity";
import { CorpusRevisionConflictError, KeywordClaimConflictError } from "./corpus-errors";
import { canonicalizeKeyword } from "./keyword-candidate";
import { extractCanonicalTokens } from "./local-tfidf-vectorizer";
import {
  computeProductKey,
  DEFAULT_CATALOG_CONFLICT_THRESHOLDS,
  isEmbeddingCompatible,
  isSameProduct,
  type CatalogConflictThresholds,
  type ExistingSeoTarget,
  type SeoConflictCorpus,
  type SeoConflictCorpusFile,
  type SeoConflictLookup,
  type SeoCorpusKeyword,
  type SeoCorpusProduct,
  type SeoProductIdentity,
  type SeoProductKeywordRegistration,
  type StoredEmbedding,
} from "./seo-conflict-corpus";

const DEFAULT_STORE_ID = "__default__";

export interface PostgresSeoConflictCorpusConfig {
  readonly storeId?: string;
  readonly thresholds?: CatalogConflictThresholds;
  readonly maxRegisteredKeywordsPerProduct?: number;
}

interface RevisionRow { revision: string | number }
interface ProductRow {
  store_id: string;
  product_key: string;
  product_id: string | null;
  handle: string | null;
  url: string | null;
  title: string | null;
  keywords: SeoCorpusKeyword[];
  updated_at: Date;
}

function mapProduct(row: ProductRow): SeoCorpusProduct {
  return {
    storeId: row.store_id === DEFAULT_STORE_ID ? undefined : row.store_id,
    productKey: row.product_key,
    productId: row.product_id ?? undefined,
    handle: row.handle ?? undefined,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    keywords: row.keywords,
  };
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(extractCanonicalTokens(left));
  const rightTokens = new Set(extractCanonicalTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function asStoredEmbedding(vector: StoredEmbedding | readonly number[] | undefined): StoredEmbedding | undefined {
  if (!vector) return undefined;
  return Array.isArray(vector)
    ? { values: vector, provider: "unknown", model: "unknown", taskType: "SEMANTIC_SIMILARITY", dimensions: vector.length }
    : vector as StoredEmbedding;
}

function normalizeOptionalIdentity(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/** PostgreSQL catalog corpus with per-store transactional serialization and unique exact claims. */
export class PostgresSeoConflictCorpus implements SeoConflictCorpus {
  private readonly storeId: string;
  private readonly thresholds: CatalogConflictThresholds;
  private readonly maxRegisteredKeywords: number;

  public constructor(private readonly pool: Pool, config: PostgresSeoConflictCorpusConfig = {}) {
    this.storeId = config.storeId?.trim() || DEFAULT_STORE_ID;
    this.thresholds = config.thresholds ?? DEFAULT_CATALOG_CONFLICT_THRESHOLDS;
    this.maxRegisteredKeywords = config.maxRegisteredKeywordsPerProduct ?? 15;
  }

  private resolveStoreId(identity?: SeoProductIdentity): string {
    return identity?.storeId?.trim() || this.storeId;
  }

  private async ensureRevision(client: PoolClient, storeId: string): Promise<number> {
    await client.query(
      "INSERT INTO seo_keyword_corpus_revisions(store_id) VALUES($1) ON CONFLICT(store_id) DO NOTHING",
      [storeId],
    );
    const row = await queryOne<RevisionRow>(client,
      "SELECT revision FROM seo_keyword_corpus_revisions WHERE store_id=$1 FOR UPDATE", [storeId]);
    return Number(row?.revision ?? 0);
  }

  public async findConflicts(
    inputOrKeyword: SeoConflictLookup | string,
    vector?: StoredEmbedding | readonly number[],
  ): Promise<readonly ExistingSeoTarget[]> {
    const lookup: SeoConflictLookup = typeof inputOrKeyword === "string"
      ? { keyword: inputOrKeyword, embedding: asStoredEmbedding(vector) }
      : inputOrKeyword;
    const normalized = lookup.normalizedKeyword ?? canonicalizeKeyword(lookup.keyword);
    if (!normalized) return [];
    const snapshot = lookup.snapshot ?? await this.getSnapshotForStore(this.resolveStoreId(lookup.owner));
    const conflicts: ExistingSeoTarget[] = [];
    for (const product of snapshot.products) {
      if (lookup.owner && isSameProduct(lookup.owner, product)) continue;
      for (const keyword of product.keywords) {
        let matchType: "exact" | "semantic" | undefined;
        let similarity: number | undefined;
        if (normalized === keyword.normalizedKeyword) {
          matchType = "exact";
          similarity = 1;
        } else if (lookup.embedding && keyword.embedding && isEmbeddingCompatible(lookup.embedding, keyword.embedding)) {
          const score = cosineSimilarity(lookup.embedding.values, keyword.embedding.values);
          const strong = score >= this.thresholds.semanticStrong;
          const contextual = score >= this.thresholds.semanticReview && keyword.rank === 0 &&
            checkContextualConflict({ candidateKeyword: lookup.keyword, candidateCategory: lookup.productCategory,
              candidateTitle: lookup.productTitle, catalogTitle: product.title, catalogKeyword: keyword.keyword });
          if (strong || contextual) { matchType = "semantic"; similarity = Number(score.toFixed(4)); }
        } else {
          const score = tokenJaccard(normalized, keyword.normalizedKeyword);
          if (score >= 0.8) { matchType = "semantic"; similarity = Number(score.toFixed(4)); }
        }
        if (!matchType) continue;
        conflicts.push({
          productKey: product.productKey, productId: product.productId, handle: product.handle,
          url: product.url ?? (product.handle ? `/products/${product.handle}` : ""), title: product.title,
          primaryKeyword: keyword.keyword, keyword: keyword.keyword,
          normalizedKeyword: keyword.normalizedKeyword, rank: keyword.rank,
          matchType, similarity, embedding: keyword.embedding,
        });
      }
    }
    return conflicts;
  }

  public async upsertProduct(registration: SeoProductKeywordRegistration): Promise<{ revision: number }> {
    const storeId = this.resolveStoreId(registration.identity);
    const productId = normalizeOptionalIdentity(registration.identity.productId);
    const handle = normalizeOptionalIdentity(registration.identity.handle);
    const url = normalizeOptionalIdentity(registration.identity.url) ?? (handle ? `/products/${handle}` : null);
    return withSeoTransaction(this.pool, async client => {
      const revision = await this.ensureRevision(client, storeId);
      if (registration.expectedRevision !== undefined && registration.expectedRevision !== revision) {
        throw new CorpusRevisionConflictError(registration.expectedRevision, revision);
      }
      const productKey = computeProductKey({ ...registration.identity, storeId: storeId === DEFAULT_STORE_ID ? undefined : storeId });
      const keywords: SeoCorpusKeyword[] = registration.approvedKeywords
        .slice(0, this.maxRegisteredKeywords)
        .map((item, rank) => {
          const keyword = typeof item === "string" ? item : item.keyword;
          const embedding = typeof item === "string" || item.embedding?.reusableAcrossRuns === false
            ? undefined : item.embedding;
          return { keyword, normalizedKeyword: typeof item === "string"
            ? canonicalizeKeyword(keyword) : item.normalizedKeyword ?? canonicalizeKeyword(keyword), rank, embedding };
        })
        .filter(keyword => keyword.normalizedKeyword.length > 0)
        .sort((a, b) => a.rank - b.rank || a.normalizedKeyword.localeCompare(b.normalizedKeyword));
      for (const keyword of keywords) {
        const claim = await queryOne<{ product_key: string }>(client,
          `SELECT product_key FROM seo_keyword_claims
           WHERE store_id=$1 AND normalized_keyword=$2 AND product_key<>$3 FOR UPDATE`,
          [storeId, keyword.normalizedKeyword, productKey]);
        if (claim) throw new KeywordClaimConflictError(storeId, keyword.normalizedKeyword, claim.product_key);
      }
      const identityMatch = await this.findIdentityProductKey(client, storeId, registration.identity);
      if (identityMatch && identityMatch !== productKey) {
        await client.query("DELETE FROM seo_keyword_products WHERE store_id=$1 AND product_key=$2", [storeId, identityMatch]);
      }
      await client.query(
        `INSERT INTO seo_keyword_products(store_id,product_key,product_id,handle,url,title,keywords,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
         ON CONFLICT(store_id,product_key) DO UPDATE SET product_id=EXCLUDED.product_id,
           handle=EXCLUDED.handle,url=EXCLUDED.url,title=EXCLUDED.title,keywords=EXCLUDED.keywords,updated_at=NOW()`,
        [storeId, productKey, productId, handle, url, registration.title ?? null, JSON.stringify(keywords)],
      );
      await client.query("DELETE FROM seo_keyword_claims WHERE store_id=$1 AND product_key=$2", [storeId, productKey]);
      for (const keyword of keywords) {
        try {
          await client.query(
            `INSERT INTO seo_keyword_claims(store_id,normalized_keyword,product_key,keyword,rank,embedding)
             VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
            [storeId, keyword.normalizedKeyword, productKey, keyword.keyword, keyword.rank,
              JSON.stringify(keyword.embedding ?? null)],
          );
        } catch (error) {
          if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
            const owner = await queryOne<{ product_key: string }>(client,
              "SELECT product_key FROM seo_keyword_claims WHERE store_id=$1 AND normalized_keyword=$2",
              [storeId, keyword.normalizedKeyword]);
            throw new KeywordClaimConflictError(storeId, keyword.normalizedKeyword, owner?.product_key ?? "unknown");
          }
          throw error;
        }
      }
      const nextRevision = revision + 1;
      await client.query(
        "UPDATE seo_keyword_corpus_revisions SET revision=$2,updated_at=NOW() WHERE store_id=$1",
        [storeId, nextRevision],
      );
      return { revision: nextRevision };
    });
  }

  private async findIdentityProductKey(
    client: PoolClient,
    storeId: string,
    identity: SeoProductIdentity,
  ): Promise<string | undefined> {
    const row = await queryOne<{ product_key: string }>(client,
      `SELECT product_key FROM seo_keyword_products WHERE store_id=$1 AND
       (($2::text IS NOT NULL AND product_id=$2) OR
        ($2::text IS NULL AND $3::text IS NOT NULL AND LOWER(handle)=LOWER($3)) OR
        ($2::text IS NULL AND $3::text IS NULL AND $4::text IS NOT NULL AND LOWER(url)=LOWER($4)))
       LIMIT 1 FOR UPDATE`,
      [storeId, identity.productId ?? null, identity.handle ?? null, identity.url ?? null]);
    return row?.product_key;
  }

  public async removeProduct(identity: SeoProductIdentity): Promise<void> {
    const storeId = this.resolveStoreId(identity);
    await withSeoTransaction(this.pool, async client => {
      const revision = await this.ensureRevision(client, storeId);
      const productKey = await this.findIdentityProductKey(client, storeId, identity);
      if (!productKey) return;
      await client.query("DELETE FROM seo_keyword_products WHERE store_id=$1 AND product_key=$2", [storeId, productKey]);
      await client.query("UPDATE seo_keyword_corpus_revisions SET revision=$2,updated_at=NOW() WHERE store_id=$1", [storeId, revision + 1]);
    });
  }

  public async reassignProduct(source: SeoProductIdentity, target: SeoProductIdentity): Promise<void> {
    const sourceStore = this.resolveStoreId(source);
    const targetStore = this.resolveStoreId(target);
    if (sourceStore !== targetStore || !target.productId) {
      throw new Error("Identity binding requires the same store and a target product ID");
    }
    await withSeoTransaction(this.pool, async client => {
      const revision = await this.ensureRevision(client, sourceStore);
      const sourceKey = await this.findIdentityProductKey(client, sourceStore, source);
      if (!sourceKey) return;
      const targetKey = await this.findIdentityProductKey(client, sourceStore, target);
      const rows = await queryRows<ProductRow>(client,
        "SELECT * FROM seo_keyword_products WHERE store_id=$1 AND product_key = ANY($2::text[]) FOR UPDATE",
        [sourceStore, [sourceKey, ...(targetKey ? [targetKey] : [])]]);
      const sourceProduct = rows.find(row => row.product_key === sourceKey);
      if (!sourceProduct) return;
      const targetProduct = rows.find(row => row.product_key === targetKey);
      const keywords = [...new Map([...(targetProduct?.keywords ?? []), ...sourceProduct.keywords]
        .map(keyword => [keyword.normalizedKeyword, keyword])).values()]
        .map((keyword, rank) => ({ ...keyword, rank }));
      await client.query("DELETE FROM seo_keyword_products WHERE store_id=$1 AND product_key = ANY($2::text[])",
        [sourceStore, [sourceKey, ...(targetKey ? [targetKey] : [])]]);
      const productKey = computeProductKey(target);
      await client.query(
        `INSERT INTO seo_keyword_products(store_id,product_key,product_id,handle,url,title,keywords)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [sourceStore, productKey, target.productId, target.handle ?? sourceProduct.handle,
          target.url ?? sourceProduct.url, targetProduct?.title ?? sourceProduct.title, JSON.stringify(keywords)],
      );
      for (const keyword of keywords) {
        await client.query(
          `INSERT INTO seo_keyword_claims(store_id,normalized_keyword,product_key,keyword,rank,embedding)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [sourceStore, keyword.normalizedKeyword, productKey, keyword.keyword, keyword.rank,
            JSON.stringify(keyword.embedding ?? null)],
        );
      }
      await client.query("UPDATE seo_keyword_corpus_revisions SET revision=$2,updated_at=NOW() WHERE store_id=$1",
        [sourceStore, revision + 1]);
    });
  }

  public async getSnapshot(): Promise<SeoConflictCorpusFile> {
    return this.getSnapshotForStore(this.storeId);
  }

  private async getSnapshotForStore(storeId: string): Promise<SeoConflictCorpusFile> {
    const [revision, rows] = await Promise.all([
      queryOne<RevisionRow>(this.pool, "SELECT revision FROM seo_keyword_corpus_revisions WHERE store_id=$1", [storeId]),
      queryRows<ProductRow>(this.pool, "SELECT * FROM seo_keyword_products WHERE store_id=$1 ORDER BY product_key", [storeId]),
    ]);
    const products = rows.map(mapProduct);
    const updatedAt = products.reduce((latest, product) => product.updatedAt > latest ? product.updatedAt : latest, new Date(0).toISOString());
    return { schemaVersion: 1, normalizationVersion: 1, revision: Number(revision?.revision ?? 0), updatedAt, products };
  }
}
