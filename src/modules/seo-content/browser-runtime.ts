import type { AppEnvironment } from "../../shared/types";

import { runMockSeoContent } from "./mocks/runner";
import type {
  SeoContentInput,
  SeoContentOutput,
  SeoContentRunOptions,
} from "./types";

export type BrowserSeoContentRunner = (
  input: SeoContentInput,
  options?: SeoContentRunOptions,
) => Promise<SeoContentOutput>;

async function rejectServerOnlySeoRun(): Promise<SeoContentOutput> {
  throw new Error(
    "SEO Content must run through the gateway API in development and production.",
  );
}

export function getBrowserSeoContentRunner(
  environment: AppEnvironment,
): BrowserSeoContentRunner {
  return environment === "mock" ? runMockSeoContent : rejectServerOnlySeoRun;
}
