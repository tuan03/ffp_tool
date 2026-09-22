import crypto from "node:crypto";

/**
 * Deterministically serializes a value to canonical JSON with sorted object keys.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs: string[] = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined && typeof val !== "symbol" && typeof val !== "function") {
      pairs.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }
  }

  return `{${pairs.join(",")}}`;
}

/**
 * Computes SHA-256 hex digest of a UTF-8 string.
 */
export function calculateSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
