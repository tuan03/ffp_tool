import { AppError } from "../../../shared/errors";

import type { SeoStageName } from "./domain-types";

export class SeoStageError extends AppError {
  public constructor(
    public readonly stageName: SeoStageName,
    message: string,
    public readonly isRecoverable: boolean = false,
    cause?: unknown,
  ) {
    super(`Stage ${stageName.toUpperCase()} failed: ${message}`, "SEO_STAGE_FAILED", cause);
    this.name = "SeoStageError";
  }
}

export function wrapStageError(
  stageName: SeoStageName,
  error: unknown,
  isRecoverable: boolean = false,
): SeoStageError {
  if (error instanceof SeoStageError) {
    return error;
  }

  const isRec =
    typeof error === "object" && error !== null && "isRecoverable" in error
      ? Boolean((error as { isRecoverable?: unknown }).isRecoverable)
      : isRecoverable;

  const message = error instanceof Error ? error.message : String(error);
  return new SeoStageError(stageName, message, isRec, error);
}
