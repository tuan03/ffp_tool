import type { KeywordCluster } from "../domain-types";
import type { KeywordAllocation } from "./content-generation-types";

export interface KeywordAllocatorInput {
  readonly approvedKeywords: readonly string[];
  readonly discardedKeywords: readonly string[];
  readonly relevanceScores?: Readonly<Record<string, number>>;
  readonly keywordClusters?: readonly KeywordCluster[];
  readonly productCategory?: string;
  readonly framingSources?: {
    readonly targetAudience?: readonly string[];
    readonly suitableOccasions?: readonly string[];
    readonly useCases?: readonly string[];
  };
}

/**
 * Tokens that indicate marketplace-specific search intent or promotional claims.
 * These should not be targeted as Primary SEO keywords on product surfaces.
 */
const MARKETPLACE_PROMO_PATTERNS: readonly RegExp[] = [
  /\bbest\b/i,
  /\bcheap\b/i,
  /\bsale\b/i,
  /\bdiscount\b/i,
  /\bnear\s+me\b/i,
  /\bamazon\b/i,
  /\betsy\b/i,
  /\bebay\b/i,
  /\bwalmart\b/i,
  /\breviews?\b/i,
  /\bcoupons?\b/i,
  /\bfree\s+shipping\b/i,
];

function isSurfaceUnsafe(phrase: string): boolean {
  return MARKETPLACE_PROMO_PATTERNS.some((pattern) => pattern.test(phrase));
}

function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Canonical equivalence check between two keyword phrases.
 */
function areCanonicalEquivalent(a: string, b: string): boolean {
  const normA = normalizePhrase(a).replace(/-/g, " ");
  const normB = normalizePhrase(b).replace(/-/g, " ");
  if (normA === normB) return true;

  // Normalized token set equality
  const tokensA = new Set(normA.split(" ").filter(Boolean));
  const tokensB = new Set(normB.split(" ").filter(Boolean));
  if (tokensA.size === tokensB.size && [...tokensA].every((t) => tokensB.has(t))) {
    return true;
  }

  return false;
}

/**
 * Deterministically allocates approved keywords into Primary, Secondary, and Supporting tiers.
 */
export function allocateKeywords(input: KeywordAllocatorInput): KeywordAllocation {
  const {
    approvedKeywords = [],
    discardedKeywords = [],
    relevanceScores = {},
    keywordClusters = [],
    productCategory = "",
    framingSources,
  } = input;

  const discardedSet = new Set(discardedKeywords.map(normalizePhrase));

  // Filter out any approved keywords that inadvertently match discarded keywords
  const validApproved = approvedKeywords.filter(
    (kw) => kw && !discardedSet.has(normalizePhrase(kw)),
  );

  // Sort candidates by relevance score descending, preserving index stability
  const sortedCandidates = [...validApproved].sort((a, b) => {
    const scoreA = relevanceScores[a] ?? 0;
    const scoreB = relevanceScores[b] ?? 0;
    return scoreB - scoreA;
  });

  // 1. Select Primary Keyword
  let primary: string | undefined;
  const categoryNorm = normalizePhrase(productCategory);
  const categoryTokens = categoryNorm.split(" ").filter((t) => t.length > 2);

  for (const candidate of sortedCandidates) {
    if (isSurfaceUnsafe(candidate)) continue;

    const words = candidate.trim().split(/\s+/);
    if (words.length < 2 || words.length > 8) continue;

    // Prefer candidates that align with category or product theme
    const candNorm = normalizePhrase(candidate);
    const hasCategoryAlignment =
      categoryTokens.length === 0 ||
      categoryTokens.some((tok) => candNorm.includes(tok));

    if (hasCategoryAlignment) {
      primary = candidate;
      break;
    }
  }

  // Fallback to highest scoring safe candidate if no strict category alignment found
  if (!primary) {
    for (const candidate of sortedCandidates) {
      if (isSurfaceUnsafe(candidate)) continue;
      const words = candidate.trim().split(/\s+/);
      if (words.length >= 2 && words.length <= 8) {
        primary = candidate;
        break;
      }
    }
  }

  // Map cluster representatives to avoid picking multiple keywords from the same cluster
  const clusterByKeyword = new Map<string, string>();
  for (const cluster of keywordClusters) {
    clusterByKeyword.set(normalizePhrase(cluster.representative), cluster.representative);
    for (const member of cluster.members) {
      clusterByKeyword.set(normalizePhrase(member), cluster.representative);
    }
  }

  const usedClusters = new Set<string>();
  if (primary) {
    const primaryCluster = clusterByKeyword.get(normalizePhrase(primary));
    if (primaryCluster) {
      usedClusters.add(primaryCluster);
    }
  }

  // 2. Select Secondary Keywords (Max 3-4, cluster diverse, not canonical to primary)
  const secondary: string[] = [];
  const maxSecondary = 4;

  for (const candidate of sortedCandidates) {
    if (secondary.length >= maxSecondary) break;
    if (primary && areCanonicalEquivalent(candidate, primary)) continue;
    if (isSurfaceUnsafe(candidate)) continue;

    const candCluster = clusterByKeyword.get(normalizePhrase(candidate));
    if (candCluster && usedClusters.has(candCluster)) {
      continue;
    }

    secondary.push(candidate);
    if (candCluster) {
      usedClusters.add(candCluster);
    }
  }

  // If we still have slots and no new clusters, add non-cluster-conflicting candidates
  if (secondary.length < 2) {
    for (const candidate of sortedCandidates) {
      if (secondary.length >= maxSecondary) break;
      if (primary && areCanonicalEquivalent(candidate, primary)) continue;
      if (secondary.some((s) => areCanonicalEquivalent(candidate, s))) continue;
      if (isSurfaceUnsafe(candidate)) continue;

      secondary.push(candidate);
    }
  }

  // 3. Select Supporting Keywords (up to 3 remaining approved keywords)
  const usedSet = new Set([
    ...(primary ? [normalizePhrase(primary)] : []),
    ...secondary.map(normalizePhrase),
  ]);

  const supportingKeywords: string[] = [];
  const maxSupporting = 3;

  for (const candidate of sortedCandidates) {
    if (supportingKeywords.length >= maxSupporting) break;
    const norm = normalizePhrase(candidate);
    if (usedSet.has(norm)) continue;
    if (isSurfaceUnsafe(candidate)) continue;

    supportingKeywords.push(candidate);
    usedSet.add(norm);
  }

  // 4. Framing Concepts (from B2 shoppingContext for prose only, not for corpus claims)
  const framingConcepts: string[] = [];
  if (framingSources) {
    const allFraming = [
      ...(framingSources.targetAudience ?? []),
      ...(framingSources.suitableOccasions ?? []),
      ...(framingSources.useCases ?? []),
    ];
    for (const concept of allFraming) {
      const trimmed = concept.trim();
      if (trimmed && !framingConcepts.includes(trimmed)) {
        framingConcepts.push(trimmed);
      }
    }
  }

  // 5. Targeted Keywords: Union of primary, secondary, supportingKeywords
  const targetedKeywords = [
    ...(primary ? [primary] : []),
    ...secondary,
    ...supportingKeywords,
  ];

  return {
    primary,
    secondary,
    supportingKeywords,
    framingConcepts,
    targetedKeywords,
  };
}
