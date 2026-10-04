import type { WorkerMetrics } from "../types";

export function mockWorkerMetrics(hours: number): WorkerMetrics {
  if (![24, 168, 720].includes(hours)) throw new Error("INVALID_METRICS_WINDOW");
  const end = Date.UTC(2030, 0, 2), start = end - hours * 3600000, bucketHours = hours === 24 ? 1 : 24;
  return { generatedAt: end, start, end, eventCoverageSince: start, hours, bucketHours,
    states: { READY: 12, PROCESSING: 2, RETRY_WAIT: 1, READY_FOR_REVIEW: 6 }, queueDepth: 13,
    successfulJobs: 6, jobsPerHour: 6 / hours, attemptsStarted: 10, attemptsEnded: 8, retriedAttempts: 2, failedAttempts: 2,
    retryRate: 0.2, failureRate: 0.25, averageProcessingMs: 120000, leaseExpirations: 1, quotaFailures: 1,
    tokenExpirations: 1, expiredTokenRequests: 1, duplicateSubmissionsPrevented: 2, staleLeaseRejections: 1, staleSourceRejections: 0,
    series: Array.from({ length: hours / bucketHours }, (_, bucket) => ({ start: start + bucket * bucketHours * 3600000, completed: bucket === 0 ? 6 : 0 })),
  };
}
