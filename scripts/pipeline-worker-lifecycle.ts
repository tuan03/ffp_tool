import { renameSync, rmSync, writeFileSync } from "node:fs";

export async function waitForCoordinator(options: {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly delay?: (ms: number) => Promise<void>;
}): Promise<void> {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 120_000);
  let lastError = "Coordinator is not ready.";
  while (now() < deadline) {
    try {
      const response = await fetcher(`${options.url}/api/v1/ready`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))),
      });
      const payload: unknown = await response.json();
      if (response.ok && payload && typeof payload === "object" && "status" in payload && payload.status === "ready") return;
      lastError = `Coordinator readiness returned HTTP ${response.status}.`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : "Readiness request failed.";
    }
    if (now() < deadline) await delay(Math.min(1000, deadline - now()));
  }
  throw new Error(`Coordinator did not become ready at ${options.url}: ${lastError}`);
}

/** Only successful pipeline requests renew readiness; unrelated background timers cannot do so. */
export function createPipelineHealth(options: { readonly file?: string; readonly now?: () => number }): {
  activity: () => void;
  stop: () => void;
} {
  const now = options.now ?? Date.now;
  let lastWritten = 0;
  let isHealthy = false;
  let isStopped = false;
  function write(status: "starting" | "healthy"): void {
    if (!options.file || isStopped) return;
    const updatedAt = now();
    const temporary = `${options.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, status, updatedAt }), { mode: 0o600 });
    renameSync(temporary, options.file);
    lastWritten = updatedAt;
  }
  write("starting");
  return {
    activity: () => {
      if (!isHealthy || now() - lastWritten >= 5000) { write("healthy"); isHealthy = true; }
    },
    stop: () => { isStopped = true; if (options.file) rmSync(options.file, { force: true }); },
  };
}

export async function shutdownPipeline(options: {
  readonly code: number;
  readonly abortUploads: () => void;
  readonly closeGateway: () => void;
  readonly closePersistence: () => Promise<unknown>;
  readonly exit: (code: number) => void;
  readonly timeoutMs?: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    options.abortUploads();
    options.closeGateway();
    await Promise.race([
      options.closePersistence(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, options.timeoutMs ?? 5000); }),
    ]);
  } catch {
    // The exit is mandatory even when cleanup fails; Supervisor must see the failure.
  } finally {
    if (timer) clearTimeout(timer);
    options.exit(options.code);
  }
}
