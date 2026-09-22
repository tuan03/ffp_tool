import type {
  ExistingSeoTarget,
  SeoConflictCorpus,
  SeoConflictCorpusFile,
  SeoConflictLookup,
  SeoProductIdentity,
  SeoProductKeywordRegistration,
  StoredEmbedding,
} from "./seo-conflict-corpus";

/**
 * Default empty implementation of SeoConflictCorpus.
 * Prevents emitting fabricated or false existing_url_cannibalization reasons
 * when the application has not been configured with an external store SEO index.
 */
export class EmptySeoConflictCorpus implements SeoConflictCorpus {
  async findConflicts(
    _inputOrKeyword: SeoConflictLookup | string,
    _vector?: StoredEmbedding | readonly number[],
  ): Promise<readonly ExistingSeoTarget[]> {
    return [];
  }

  async upsertProduct(
    _registration: SeoProductKeywordRegistration,
  ): Promise<{ revision: number }> {
    return { revision: 0 };
  }

  async removeProduct(_identity: SeoProductIdentity): Promise<void> {}

  async getSnapshot(): Promise<SeoConflictCorpusFile> {
    return {
      schemaVersion: 1,
      normalizationVersion: 1,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
      products: [],
    };
  }
}
