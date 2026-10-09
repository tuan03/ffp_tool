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
  const normalized: string[] = [];
  let letterRun: string[] = [];

  const flushLetterRun = (): void => {
    // Vision models sometimes return a vertically printed name as A, M, E, L,
    // I, A. Guarding each character would reject ordinary English articles and
    // pronouns, so preserve the artwork text as one enforceable literal instead.
    if (letterRun.length > 1) normalized.push(letterRun.join(""));
    letterRun = [];
  };

  for (const literal of literals) {
    const candidate = literal.replace(/\s+/g, " ").trim();
    if (/^\p{L}$/u.test(candidate)) {
      letterRun.push(candidate);
      continue;
    }
    flushLetterRun();
    if (candidate) normalized.push(candidate);
  }
  flushLetterRun();

  const seen = new Set<string>();
  return normalized.filter((literal) => {
    const key = literal.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findExcludedLiterals(
  value: unknown,
  literals: readonly string[],
  path = "content",
): readonly { readonly path: string; readonly literal: string }[] {
  if (typeof value === "string") {
    return literals
      .filter((candidate) => literalPattern(candidate)?.test(value))
      .map((literal) => ({ path, literal }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findExcludedLiterals(entry, literals, `${path}[${index}]`),
    );
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    findExcludedLiterals(entry, literals, `${path}.${key}`),
  );
}

export function formatExcludedLiteralViolations(
  violations: readonly { readonly path: string; readonly literal: string }[],
  maximumDetails = 12,
): string {
  const unique = [...new Map(
    violations.map((violation) => [
      `${violation.path}\u0000${violation.literal.toLocaleLowerCase()}`,
      violation,
    ]),
  ).values()];
  const details = unique
    .slice(0, maximumDetails)
    .map(({ path, literal }) => `${path} contains ${JSON.stringify(literal)}`)
    .join("; ");
  const remaining = unique.length - maximumDetails;
  return remaining > 0 ? `${details}; and ${remaining} more violation(s)` : details;
}

export function findExcludedLiteral(
  value: unknown,
  literals: readonly string[],
  path = "content",
): { readonly path: string; readonly literal: string } | undefined {
  return findExcludedLiterals(value, literals, path)[0];
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
