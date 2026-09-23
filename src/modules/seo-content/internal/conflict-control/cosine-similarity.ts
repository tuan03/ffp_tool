/**
 * Computes the cosine similarity between two numeric vectors.
 *
 * Guaranteed invariants:
 * - Returns 0 on length mismatch, empty vectors, or zero magnitude.
 * - Handles NaN, Infinity, and non-finite numbers safely.
 * - Result is strictly bounded within [-1, 1].
 */
export function cosineSimilarity(
  vectorA: readonly number[],
  vectorB: readonly number[],
): number {
  if (!vectorA || !vectorB) {
    return 0;
  }

  const length = vectorA.length;
  if (length === 0 || length !== vectorB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < length; i++) {
    const valA = vectorA[i];
    const valB = vectorB[i];

    if (!Number.isFinite(valA) || !Number.isFinite(valB)) {
      return 0;
    }

    dotProduct += valA * valB;
    normASq += valA * valA;
    normBSq += valB * valB;
  }

  if (normASq <= 0 || normBSq <= 0) {
    return 0;
  }

  const denominator = Math.sqrt(normASq) * Math.sqrt(normBSq);
  if (!Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  const rawCosine = dotProduct / denominator;
  if (!Number.isFinite(rawCosine)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, rawCosine));
}
