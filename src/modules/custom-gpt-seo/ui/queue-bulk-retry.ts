import type { CustomGptClient } from "../service";
import type { QueueRetryOutcome } from "../types";

export interface QueueRetryRun {
  readonly requestId: string;
  readonly storeId: string;
  readonly jobIds: readonly string[];
  readonly outcomes: readonly QueueRetryOutcome[];
}

/** Snapshot IDs never use a shrinking queue's offset; replay the interrupted chunk with the same key. */
export async function continueQueueRetry(input: {
  readonly client: Pick<CustomGptClient, "retryBatch">;
  readonly run: QueueRetryRun;
  readonly shouldStop: () => boolean;
  readonly onProgress: (run: QueueRetryRun) => void;
}): Promise<QueueRetryRun> {
  let run = input.run;
  while (run.outcomes.length < run.jobIds.length && !input.shouldStop()) {
    const ids = run.jobIds.slice(run.outcomes.length, run.outcomes.length + 20);
    const response = await input.client.retryBatch(run.storeId, ids, run.requestId);
    if (response.outcomes.length !== ids.length || ids.some((id, index) => response.outcomes[index]?.jobId !== id)
      || response.outcomes.some(outcome => !["retried", "skipped", "failed"].includes(outcome.status))) {
      throw new Error("Chưa xác nhận được kết quả nhóm hiện tại. Có thể tiếp tục để đối chiếu lại.");
    }
    run = { ...run, outcomes: [...run.outcomes, ...response.outcomes] };
    input.onProgress(run);
  }
  return run;
}
