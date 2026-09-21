import type { AppEnvironment } from "../../shared/types";
import { MockAutoSeoClient } from "./mocks/runner";
import { RealAutoSeoClient } from "./service";
import type { AutoSeoClient } from "./types";

export function getAutoSeoClient(environment: AppEnvironment): AutoSeoClient {
  if (environment === "mock") {
    return new MockAutoSeoClient();
  }

  return new RealAutoSeoClient();
}
