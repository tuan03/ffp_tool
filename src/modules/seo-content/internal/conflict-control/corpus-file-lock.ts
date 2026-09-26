import fs from "node:fs/promises";
import path from "node:path";
import { CorpusLockTimeoutError } from "./corpus-errors";

/** In-process queue to serialize concurrent operations on the same file path in the same event loop */
const inProcessQueues = new Map<string, Promise<unknown>>();

async function enqueueInProcess<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const current = inProcessQueues.get(filePath) ?? Promise.resolve();
  let taskResolve: (val: unknown) => void;
  const next = new Promise((res) => {
    taskResolve = res;
  });
  inProcessQueues.set(filePath, next);

  try {
    await current;
    return await task();
  } finally {
    taskResolve!(undefined);
    if (inProcessQueues.get(filePath) === next) {
      inProcessQueues.delete(filePath);
    }
  }
}

/**
 * Executes an operation with a file-based lock.
 * Employs atomic flag "wx" creation, stale-lock detection, and retries.
 */
export async function withFileLock<T>(
  filePath: string,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  const normalizedPath = path.resolve(filePath);
  return enqueueInProcess(normalizedPath, async () => {
    const lockPath = `${normalizedPath}.lock`;
    const staleTimeoutMs = Math.max(1000, Math.min(10000, timeoutMs));
    const startTime = Date.now();
    let lockHandle: fs.FileHandle | undefined;

    // Ensure parent directory exists before locking
    await fs.mkdir(path.dirname(normalizedPath), { recursive: true });

    while (Date.now() - startTime < timeoutMs) {
      try {
        lockHandle = await fs.open(lockPath, "wx");
        break;
      } catch (err: unknown) {
        const nodeErr = err as { code?: string };
        if (nodeErr.code === "EEXIST") {
          // Check for stale lock file
          try {
            const stat = await fs.stat(lockPath);
            if (Date.now() - stat.mtimeMs > staleTimeoutMs) {
              await fs.unlink(lockPath).catch(() => {});
              continue;
            }
          } catch {
            // Lock was removed by another process in the meantime
            continue;
          }

          // Backoff delay before retry
          await new Promise((res) => setTimeout(res, 40));
          continue;
        }
        throw err;
      }
    }

    if (!lockHandle) {
      throw new CorpusLockTimeoutError(lockPath, timeoutMs);
    }

    try {
      return await operation();
    } finally {
      try {
        await lockHandle.close();
      } catch {
        // Ignore handle close errors
      }
      try {
        await fs.unlink(lockPath);
      } catch {
        // Ignore unlink error if already removed
      }
    }
  });
}
