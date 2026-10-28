import { useEffect, useRef, useState } from "react";

import type { CustomGptClient } from "../service";
import type { QueueRetryOutcome, SeoProvider } from "../types";
import { continueQueueRetry } from "./queue-bulk-retry";
import type { QueueRetryRun } from "./queue-bulk-retry";

interface QueueBulkRetryState {
  readonly run: QueueRetryRun | null;
  readonly isRunning: boolean;
  readonly error: string | null;
  readonly start: (ids?: readonly string[]) => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly stop: () => void;
}

export function useQueueBulkRetry(input: {
  readonly client: CustomGptClient;
  readonly storeId: string;
  readonly provider?: SeoProvider;
  readonly onConfirmed: (outcomes: readonly QueueRetryOutcome[]) => void;
  readonly onFinish: () => void;
}): QueueBulkRetryState {
  const [run, setRun] = useState<QueueRetryRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const stop = useRef(false);
  const generation = useRef(0);
  const callbacks = useRef(input);
  callbacks.current = input;
  useEffect(() => {
    setRun(null); setError(null); setIsRunning(false); running.current = false;
    return () => { stop.current = true; generation.current += 1; };
  }, [input.storeId, input.provider]);

  async function execute(previous: QueueRetryRun | null, selectedIds?: readonly string[]): Promise<void> {
    if (running.current) return;
    running.current = true; stop.current = false; setIsRunning(true); setError(null);
    if (!previous) setRun(null);
    const currentGeneration = generation.current;
    const isCurrent = () => currentGeneration === generation.current;
    try {
      const currentRun = previous ?? {
        storeId: input.storeId, requestId: crypto.randomUUID(), outcomes: [],
        jobIds: [...new Set(selectedIds ?? (await input.client.retryCandidates(input.storeId, input.provider)).jobIds)],
      };
      if (!isCurrent()) return;
      setRun(currentRun);
      let confirmed = currentRun.outcomes.length;
      await continueQueueRetry({ client: input.client, run: currentRun,
        shouldStop: () => stop.current || !isCurrent(),
        onProgress: next => {
          if (!isCurrent()) return;
          setRun(next);
          callbacks.current.onConfirmed(next.outcomes.slice(confirmed));
          confirmed = next.outcomes.length;
        },
      });
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : "Chưa xác nhận được nhóm hiện tại. Phần đã thành công được giữ nguyên.");
    } finally {
      if (isCurrent()) { running.current = false; setIsRunning(false); callbacks.current.onFinish(); }
    }
  }
  return {
    run, isRunning, error,
    start: (ids?: readonly string[]) => execute(null, ids),
    resume: () => run ? execute(run) : Promise.resolve(),
    stop: () => { stop.current = true; },
  };
}
