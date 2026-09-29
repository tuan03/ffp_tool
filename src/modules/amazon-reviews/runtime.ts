import type { AppEnvironment } from "../../shared/types";

import { createMockReviewClient } from "./mocks/runner";
import { createReviewClient } from "./service";
import type { ReviewClient } from "./types";

export function getReviewClient(environment: AppEnvironment, coordinatorUrl: string): ReviewClient {
  return environment === "mock" ? createMockReviewClient() : createReviewClient({ coordinatorUrl });
}
