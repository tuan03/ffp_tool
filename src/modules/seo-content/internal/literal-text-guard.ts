function escapedLiteral(literal: string): string {
  return literal.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function literalPattern(literal: string, global = false): RegExp | undefined {
  const escaped = escapedLiteral(literal);
  if (!escaped) return undefined;
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    global ? "giu" : "iu",
  );
}

export function normalizeExcludedLiterals(literals: readonly string[]): readonly string[] {
  const normalized = literals
    .map((literal) => literal.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function findExcludedLiteral(
  value: unknown,
  literals: readonly string[],
  path = "content",
): { readonly path: string; readonly literal: string } | undefined {
  if (typeof value === "string") {
    const literal = literals.find((candidate) => literalPattern(candidate)?.test(value));
    return literal ? { path, literal } : undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findExcludedLiteral(value[index], literals, `${path}[${index}]`);
      if (match) return match;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const match = findExcludedLiteral(entry, literals, `${path}.${key}`);
    if (match) return match;
  }
  return undefined;
}

export function redactExcludedLiterals(
  value: string,
  literals: readonly string[],
  fallback: string,
): string {
  let redacted = value;
  for (const literal of literals) {
    const pattern = literalPattern(literal, true);
    if (pattern) redacted = redacted.replace(pattern, "$1");
  }
  const cleaned = redacted
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .trim();
  return cleaned || fallback;
}
