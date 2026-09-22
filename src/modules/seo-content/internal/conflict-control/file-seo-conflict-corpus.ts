import fs from "node:fs/promises";
import path from "node:path";

import { canonicalizeKeyword } from "./keyword-candidate";
import { cosineSimilarity } from "./cosine-similarity";
import { extractCanonicalTokens } from "./local-tfidf-vectorizer";
import { checkContextualConflict } from "./contextual-conflict-evaluator";
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
import {
  CorpusRevisionConflictError,
  SeoConflictCorpusCorruptError,
} from "./corpus-errors";
import { withFileLock } from "./corpus-file-lock";

export interface FileSeoConflictCorpusConfig {
  readonly filePath?: string;
  readonly thresholds?: CatalogConflictThresholds;
  readonly lockTimeoutMs?: number;
  readonly maxRegisteredKeywordsPerProduct?: number;
}

/**
 * File-based Store Catalog SEO Conflict Corpus.
 *
 * Implements Cross-Product Keyword Cannibalization Prevention across store catalog.
 * Guarantees:
 * - Single vector space invariant & persistent embedding reuse rules.
 * - Self-conflict exclusion (products never cannibalize their own keywords on rerun).
 * - Atomic persistence via temp-file swap and fsync.
 * - Deterministic serialized JSON formatting.
 * - Zero-network execution when isolated in test temp folders.
 */
export class FileSeoConflictCorpus implements SeoConflictCorpus {
  private readonly filePath: string;
  private readonly thresholds: CatalogConflictThresholds;
  private readonly lockTimeoutMs: number;
  private readonly maxRegisteredKeywords: number;

  constructor(config?: FileSeoConflictCorpusConfig) {
    const isBrowser =
      typeof window !== "undefined" && typeof window.document !== "undefined";

    const isNode =
      !isBrowser &&
      typeof process !== "undefined" &&
      typeof process.cwd === "function" &&
      typeof path !== "undefined" &&
      typeof path.resolve === "function";

    this.filePath =
      config?.filePath ??
      (typeof process !== "undefined" && process.env?.SEO_CONFLICT_CORPUS_PATH
        ? process.env.SEO_CONFLICT_CORPUS_PATH
        : isNode
          ? path.resolve(process.cwd(), "data/seo-content/conflict-corpus.json")
          : "data/seo-content/conflict-corpus.json");

    this.thresholds = config?.thresholds ?? DEFAULT_CATALOG_CONFLICT_THRESHOLDS;
    this.lockTimeoutMs = config?.lockTimeoutMs ?? 5000;
    this.maxRegisteredKeywords = config?.maxRegisteredKeywordsPerProduct ?? 8;
  }

  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Reads and parses the corpus JSON file.
   * If missing, initializes an empty deterministic corpus.
   * If corrupt/invalid JSON, throws SeoConflictCorpusCorruptError.
   */
  private async readCorpusFile(): Promise<SeoConflictCorpusFile> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      if (content.trim().length === 0) {
        return {
          schemaVersion: 1,
          normalizationVersion: 1,
          revision: 0,
          updatedAt: new Date(0).toISOString(),
          products: [],
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (jsonErr) {
        throw new SeoConflictCorpusCorruptError(this.filePath, jsonErr);
      }

      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { schemaVersion?: number }).schemaVersion !== 1 ||
        !Array.isArray((parsed as { products?: unknown[] }).products)
      ) {
        throw new SeoConflictCorpusCorruptError(
          this.filePath,
          new Error("Invalid corpus schema structure"),
        );
      }

      return parsed as SeoConflictCorpusFile;
    } catch (err: unknown) {
      const nodeErr = err as { code?: string };
      if (nodeErr.code === "ENOENT") {
        return {
          schemaVersion: 1,
          normalizationVersion: 1,
          revision: 0,
          updatedAt: new Date(0).toISOString(),
          products: [],
        };
      }
      throw err;
    }
  }

  /**
   * Writes the corpus file atomically using a temp file in the same directory,
   * with fsync before renaming to avoid partial/corrupted writes.
   * Cleans up temporary file if write or rename fails.
   */
  private async writeCorpusFile(corpus: SeoConflictCorpusFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = path.join(
      dir,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );

    const serialized = JSON.stringify(corpus, null, 2) + "\n";

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tempPath, "w");
      await handle.writeFile(serialized, "utf-8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempPath, this.filePath);
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  /**
   * Calculates Token Jaccard overlap between two canonical keyword phrases,
   * applying domain synonym canonicalization.
   */
  private computeTokenJaccard(canonicalA: string, canonicalB: string): number {
    const tokensA = new Set(extractCanonicalTokens(canonicalA));
    const tokensB = new Set(extractCanonicalTokens(canonicalB));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        intersection++;
      }
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Checks for cross-product keyword conflicts against the catalog corpus.
   * Excludes the current product to prevent self-conflict.
   */
  async findConflicts(
    inputOrKeyword: SeoConflictLookup | string,
    vector?: StoredEmbedding | readonly number[],
  ): Promise<readonly ExistingSeoTarget[]> {
    let lookup: SeoConflictLookup;
    if (typeof inputOrKeyword === "string") {
      let emb: StoredEmbedding | undefined;
      if (vector) {
        if (Array.isArray(vector)) {
          emb = {
            values: vector,
            provider: "unknown",
            model: "unknown",
            taskType: "SEMANTIC_SIMILARITY",
            dimensions: vector.length,
          };
        } else {
          emb = vector as StoredEmbedding;
        }
      }
      lookup = {
        keyword: inputOrKeyword,
        embedding: emb,
      };
    } else {
      lookup = inputOrKeyword;
    }

    const normCandidate = lookup.normalizedKeyword ?? canonicalizeKeyword(lookup.keyword);
    if (!normCandidate) {
      return [];
    }

    const corpus = lookup.snapshot ?? (await this.readCorpusFile());
    const conflicts: ExistingSeoTarget[] = [];

    for (const product of corpus.products) {
      // 1. Self-conflict check: ignore if this is the same product identity
      if (
        lookup.owner &&
        isSameProduct(lookup.owner, {
          productId: product.productId,
          handle: product.handle,
          url: product.url,
        })
      ) {
        continue;
      }

      const productUrl =
        product.url ?? (product.handle ? `/products/${product.handle}` : "");

      for (const kw of product.keywords) {
        // Tier 1: Exact Normalized Keyword Match
        if (normCandidate === kw.normalizedKeyword) {
          conflicts.push({
            productKey: product.productKey,
            productId: product.productId,
            handle: product.handle,
            url: productUrl,
            title: product.title,
            primaryKeyword: kw.keyword,
            keyword: kw.keyword,
            normalizedKeyword: kw.normalizedKeyword,
            rank: kw.rank,
            matchType: "exact",
            similarity: 1.0,
            embedding: kw.embedding,
          });
          continue;
        }

        let canCompareDense = false;

        // Tier 2: Semantic Vector Match (if both have compatible embeddings)
        if (lookup.embedding && kw.embedding) {
          if (isEmbeddingCompatible(lookup.embedding, kw.embedding)) {
            canCompareDense = true;
            const sim = cosineSimilarity(
              lookup.embedding.values,
              kw.embedding.values,
            );

            const isPrimary = kw.rank === 0;
            let isConflict = false;

            if (sim >= this.thresholds.semanticStrong) {
              isConflict = true;
            } else if (sim >= this.thresholds.semanticReview) {
              // Gray zone [0.86, 0.90)
              if (isPrimary) {
                if (lookup.productCategory || lookup.productTitle) {
                  isConflict = checkContextualConflict({
                    candidateKeyword: lookup.keyword,
                    candidateCategory: lookup.productCategory,
                    candidateTitle: lookup.productTitle,
                    catalogTitle: product.title,
                    catalogKeyword: kw.keyword,
                  });
                } else {
                  isConflict = true;
                }
              }
            }

            if (isConflict) {
              conflicts.push({
                productKey: product.productKey,
                productId: product.productId,
                handle: product.handle,
                url: productUrl,
                title: product.title,
                primaryKeyword: kw.keyword,
                keyword: kw.keyword,
                normalizedKeyword: kw.normalizedKeyword,
                rank: kw.rank,
                matchType: "semantic",
                similarity: Number(sim.toFixed(4)),
                embedding: kw.embedding,
              });
              continue;
            }
          }
        }

        // Tier 2b: Fallback Token Jaccard match when dense vectors are not available or incompatible
        if (!canCompareDense) {
          const jaccard = this.computeTokenJaccard(
            normCandidate,
            kw.normalizedKeyword,
          );
          // Very high token overlap (e.g. 4/5 tokens) in absence of embeddings
          if (jaccard >= 0.80) {
            conflicts.push({
              productKey: product.productKey,
              productId: product.productId,
              handle: product.handle,
              url: productUrl,
              title: product.title,
              primaryKeyword: kw.keyword,
              keyword: kw.keyword,
              normalizedKeyword: kw.normalizedKeyword,
              rank: kw.rank,
              matchType: "semantic",
              similarity: Number(jaccard.toFixed(4)),
              embedding: kw.embedding,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Upserts approved keywords for a product into the catalog database.
   * REPLACES the product's entire keyword claim set (never appends).
   * Enforces optimistic locking revision checking and deterministic serialization.
   */
  async upsertProduct(
    registration: SeoProductKeywordRegistration,
  ): Promise<{ revision: number }> {
    return withFileLock(this.filePath, this.lockTimeoutMs, async () => {
      const current = await this.readCorpusFile();

      if (
        registration.expectedRevision !== undefined &&
        registration.expectedRevision !== current.revision
      ) {
        throw new CorpusRevisionConflictError(
          registration.expectedRevision,
          current.revision,
        );
      }

      const rawKeywords = registration.approvedKeywords.slice(
        0,
        this.maxRegisteredKeywords,
      );

      const registeredKeywords: SeoCorpusKeyword[] = [];
      for (let rank = 0; rank < rawKeywords.length; rank++) {
        const item = rawKeywords[rank];
        const rawKw = typeof item === "string" ? item : item.keyword;
        const normKw =
          typeof item === "string"
            ? canonicalizeKeyword(rawKw)
            : (item.normalizedKeyword ?? canonicalizeKeyword(rawKw));

        const emb = typeof item === "string" ? undefined : item.embedding;
        // Invariant: only persist reusable embeddings across runs
        const cleanEmb =
          emb && emb.reusableAcrossRuns !== false ? emb : undefined;

        registeredKeywords.push({
          keyword: rawKw,
          normalizedKeyword: normKw,
          rank,
          embedding: cleanEmb,
        });
      }

      // Deterministic keyword sorting: rank ASC, then normalizedKeyword ASC
      registeredKeywords.sort(
        (a, b) => a.rank - b.rank || a.normalizedKeyword.localeCompare(b.normalizedKeyword),
      );

      const productKey = computeProductKey(registration.identity);
      const nowIso = new Date().toISOString();

      const updatedProduct: SeoCorpusProduct = {
        productKey,
        productId: registration.identity.productId,
        handle: registration.identity.handle,
        url:
          registration.identity.url ??
          (registration.identity.handle
            ? `/products/${registration.identity.handle}`
            : undefined),
        title: registration.title,
        updatedAt: nowIso,
        keywords: registeredKeywords,
      };

      // Replace existing product or append new product
      const existingIdx = current.products.findIndex((p) =>
        isSameProduct(registration.identity, p),
      );

      const updatedProducts = [...current.products];
      if (existingIdx >= 0) {
        updatedProducts[existingIdx] = updatedProduct;
      } else {
        updatedProducts.push(updatedProduct);
      }

      // Deterministic product sorting by productKey ASC
      updatedProducts.sort((a, b) => a.productKey.localeCompare(b.productKey));

      const newRevision = current.revision + 1;
      const updatedCorpus: SeoConflictCorpusFile = {
        schemaVersion: 1,
        normalizationVersion: 1,
        revision: newRevision,
        updatedAt: nowIso,
        products: updatedProducts,
      };

      await this.writeCorpusFile(updatedCorpus);
      return { revision: newRevision };
    });
  }

  /**
   * Removes a product and releases all its claimed keywords from the corpus.
   */
  async removeProduct(identity: SeoProductIdentity): Promise<void> {
    await withFileLock(this.filePath, this.lockTimeoutMs, async () => {
      const current = await this.readCorpusFile();
      const filtered = current.products.filter(
        (p) => !isSameProduct(identity, p),
      );

      if (filtered.length === current.products.length) {
        return; // Nothing to remove
      }

      const newRevision = current.revision + 1;
      const updatedCorpus: SeoConflictCorpusFile = {
        schemaVersion: 1,
        normalizationVersion: 1,
        revision: newRevision,
        updatedAt: new Date().toISOString(),
        products: filtered,
      };

      await this.writeCorpusFile(updatedCorpus);
    });
  }

  /**
   * Returns a snapshot of the current catalog corpus file.
   */
  async getSnapshot(): Promise<SeoConflictCorpusFile> {
    return this.readCorpusFile();
  }
}
