import type { GptQueuePage } from "../service";

/** Only call after the retry mutation is acknowledged; background reads reconcile worker claims. */
export function applyConfirmedQueueRetry(queue: GptQueuePage, jobId: string): GptQueuePage {
  const job = queue.jobs.find(candidate => candidate.id === jobId);
  if (!job || !["FAILED", "WAITING_INPUT", "NEEDS_CHANGES"].includes(job.status)) return queue;
  return {
    ...queue,
    jobs: queue.jobs.map(candidate => candidate.id === jobId
      ? { ...candidate, status: "PENDING", error: undefined } : candidate),
    counts: {
      ...queue.counts,
      [job.status]: Math.max(0, (queue.counts[job.status] ?? 0) - 1),
      PENDING: (queue.counts.PENDING ?? 0) + 1,
    },
  };
}
