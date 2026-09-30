import type {
  SeoContentInput,
  SeoContentOutput,
  SeoContentRunOptions,
} from "./types";

export async function runDefaultSeoContent(
  input: SeoContentInput,
  options?: SeoContentRunOptions,
): Promise<SeoContentOutput> {
  const { runSeoContent } = await import("./service");
  return runSeoContent(input, options);
}
