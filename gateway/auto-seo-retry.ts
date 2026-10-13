import type { GptSeoJob } from "../src/modules/custom-gpt-seo";

export type AutoSeoSentBackupDisposition = "RETRY" | "UNCHANGED" | "ACTIVE_DUPLICATE";

/** A handoff receipt is not proof of SEO completion after an operator clears its job. */
export function getAutoSeoSentBackupDisposition(
  job: GptSeoJob | null,
  hasPendingReview: boolean,
): AutoSeoSentBackupDisposition {
  if (job?.shopifySyncStatus === "SYNCED") return "UNCHANGED";
  if (hasPendingReview || (job?.shopifySyncStatus && job.shopifySyncStatus !== "ROLLED_BACK")) {
    return "ACTIVE_DUPLICATE";
  }
  if (job?.status === "CANCELLED" && job.cancellationReason === "OPERATOR_QUEUE_CLEAR") return "RETRY";
  if (job && job.status !== "CANCELLED") return "ACTIVE_DUPLICATE";
  // Preserve historical/Gemini receipts when there is no proof of an operator clear.
  return "UNCHANGED";
}
