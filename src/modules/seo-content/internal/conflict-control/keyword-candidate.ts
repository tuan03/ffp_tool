import { CONFLICT_REASON, type ConflictReasonCode } from "./conflict-reason";

import type { SearchResearchResult } from "../domain-types";

export interface KeywordCandidate {
  readonly keyword: string;
  readonly normalized: string;
  readonly canonical: string;
  readonly source: string;
  readonly originalIndex: number;
}

export interface ExactDuplicateResult {
  readonly uniqueCandidates: readonly KeywordCandidate[];
  readonly discardedCandidates: ReadonlyArray<{
    readonly candidate: KeywordCandidate;
    readonly reason: ConflictReasonCode;
  }>;
}

/**
 * Normalizes keyword for matching and exact duplicate detection:
 * - Unicode NFKC normalization
 * - Lowercase
 * - Collapse multiple spaces into a single space
 * - Normalize hyphens around words: e.g. "t - shirt" -> "t-shirt"
 * - Trim whitespace
 */
export function canonicalizeKeyword(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[\s,.;:!?'"()\[\]{}]+|[\s,.;:!?'"()\[\]{}]+$/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds candidate pool from B3 SearchResearchResult with preserved provenance.
 */
export function buildKeywordCandidates(
  searchResearch?: SearchResearchResult,
): readonly KeywordCandidate[] {
  if (!searchResearch) {
    return [];
  }

  const candidates: KeywordCandidate[] = [];
  let index = 0;

  const sources = searchResearch.querySources ?? {};

  // 1. Process seed keywords
  for (const seed of searchResearch.seedKeywords ?? []) {
    const trimmed = seed.trim();
    if (!trimmed) {
      continue;
    }
    const canonical = canonicalizeKeyword(trimmed);
    const source = sources[trimmed] || "seed";
    candidates.push({
      keyword: trimmed,
      normalized: trimmed.toLowerCase(),
      canonical,
      source,
      originalIndex: index++,
    });
  }

  // 2. Process suggested queries
  for (const query of searchResearch.suggestedQueries ?? []) {
    const trimmed = query.trim();
    if (!trimmed) {
      continue;
    }
    const canonical = canonicalizeKeyword(trimmed);
    const source = sources[trimmed] || "google_autocomplete";
    candidates.push({
      keyword: trimmed,
      normalized: trimmed.toLowerCase(),
      canonical,
      source,
      originalIndex: index++,
    });
  }

  return candidates;
}

/**
 * Removes exact duplicates prior to vectorization:
 * - Keeps first occurrence of canonicalized keyword.
 * - Discards subsequent identical occurrences with reason 'exact_duplicate'.
 */
export function removeExactDuplicates(
  candidates: readonly KeywordCandidate[],
): ExactDuplicateResult {
  const seenCanonical = new Set<string>();
  const uniqueCandidates: KeywordCandidate[] = [];
  const discardedCandidates: Array<{
    candidate: KeywordCandidate;
    reason: ConflictReasonCode;
  }> = [];

  for (const candidate of candidates) {
    if (!candidate.canonical) {
      continue;
    }

    if (seenCanonical.has(candidate.canonical)) {
      discardedCandidates.push({
        candidate,
        reason: CONFLICT_REASON.EXACT_DUPLICATE,
      });
    } else {
      seenCanonical.add(candidate.canonical);
      uniqueCandidates.push(candidate);
    }
  }

  return {
    uniqueCandidates,
    discardedCandidates,
  };
}
