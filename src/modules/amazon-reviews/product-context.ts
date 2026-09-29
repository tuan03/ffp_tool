import type { AmazonReviewContext } from "./types";

export function hasUsableReviewContext(context: AmazonReviewContext | undefined): context is AmazonReviewContext {
  if (!context) return false;
  const facts = [context.title, context.description, ...(context.bullets ?? []), ...Object.values(context.details ?? {})];
  return facts.some((fact) => typeof fact === "string" && fact.trim().length >= 4);
}
