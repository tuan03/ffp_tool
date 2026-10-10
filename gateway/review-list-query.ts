import type { SeoReviewListQuery } from "../src/shared/seo-review-list";

export function readReviewListQuery(url: URL, storeId: string): SeoReviewListQuery {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const search = (url.searchParams.get("search") ?? "").trim();
  const decision = url.searchParams.get("decision") ?? "";
  if (!storeId || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50 || search.length > 200 ||
    (decision && !["pending", "approved", "rejected", "sync_failed"].includes(decision))) throw new Error("Invalid review list query");
  return { storeId, offset, limit, search, ...(decision ? { decision: decision as SeoReviewListQuery["decision"] } : {}) };
}

export function reviewListWhere(query: SeoReviewListQuery): { sql: string; parameters: readonly (string | number)[] } {
  const conditions = ["store_id=?"];
  const parameters: (string | number)[] = [query.storeId];
  if (query.search) {
    conditions.push("(title ILIKE ? ESCAPE '\\' OR handle ILIKE ? ESCAPE '\\' OR asin ILIKE ? ESCAPE '\\')");
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    parameters.push(pattern, pattern, pattern);
  }
  if (query.decision) {
    conditions.push(query.decision === "sync_failed" ? "sync_status='failed'" : "decision=?");
    if (query.decision !== "sync_failed") parameters.push(query.decision);
  }
  return { sql: conditions.join(" AND "), parameters };
}
