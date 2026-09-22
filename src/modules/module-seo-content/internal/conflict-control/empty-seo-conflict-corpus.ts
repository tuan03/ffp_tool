import type { ExistingSeoTarget, SeoConflictCorpus } from "./seo-conflict-corpus";

/**
 * Default empty implementation of SeoConflictCorpus.
 * Prevents emitting fabricated or false existing_url_cannibalization reasons
 * when the application has not been configured with an external store SEO index.
 */
export class EmptySeoConflictCorpus implements SeoConflictCorpus {
  async findConflicts(
    _keyword: string,
    _vector?: readonly number[],
  ): Promise<readonly ExistingSeoTarget[]> {
    return [];
  }
}
