import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { SeoCheckpoint, SeoCheckpointStore } from "./types";

/**
 * In-memory checkpoint store for isolated unit tests, mock modes,
 * and zero-network local executions.
 */
export class InMemorySeoCheckpointStore implements SeoCheckpointStore {
  private readonly store = new Map<string, SeoCheckpoint>();

  public async get(inputHash: string): Promise<SeoCheckpoint | null> {
    const existing = this.store.get(inputHash);
    if (!existing) return null;
    return structuredClone(existing);
  }

  public async set(checkpoint: SeoCheckpoint): Promise<void> {
    this.store.set(checkpoint.inputHash, structuredClone(checkpoint));
  }

  public async delete(inputHash: string): Promise<void> {
    this.store.delete(inputHash);
  }

  public async pruneExpired(now: number = Date.now()): Promise<number> {
    let prunedCount = 0;
    for (const [key, checkpoint] of this.store.entries()) {
      if (checkpoint.expiresAt <= now) {
        this.store.delete(key);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

export interface FileSeoCheckpointStoreOptions {
  readonly baseDirectory?: string;
}

/**
 * File-based persistent checkpoint store saving to `.runtime/seo-checkpoints/`
 * with atomic writes (temp file + fsync + atomic rename) and automatic directory creation.
 */
export class FileSeoCheckpointStore implements SeoCheckpointStore {
  private readonly baseDirectory: string;

  constructor(options: FileSeoCheckpointStoreOptions = {}) {
    this.baseDirectory = options.baseDirectory
      ? path.resolve(options.baseDirectory)
      : path.resolve(".runtime/seo-checkpoints");
  }

  public getBaseDirectory(): string {
    return this.baseDirectory;
  }

  private getFilePath(inputHash: string): string {
    const safeHash = inputHash.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDirectory, `${safeHash}.json`);
  }

  public async get(inputHash: string): Promise<SeoCheckpoint | null> {
    const filePath = this.getFilePath(inputHash);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as SeoCheckpoint;
      return parsed;
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "ENOENT") {
        return null;
      }
      return null;
    }
  }

  public async set(checkpoint: SeoCheckpoint): Promise<void> {
    await fs.mkdir(this.baseDirectory, { recursive: true });

    const targetFile = this.getFilePath(checkpoint.inputHash);
    const tempFile = path.join(
      this.baseDirectory,
      `.${path.basename(targetFile)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );

    const serialized = JSON.stringify(checkpoint, null, 2) + "\n";

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tempFile, "w");
      await handle.writeFile(serialized, "utf-8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempFile, targetFile);
    } catch (err: unknown) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(tempFile).catch(() => {});
      throw err;
    }
  }

  public async delete(inputHash: string): Promise<void> {
    const targetFile = this.getFilePath(inputHash);
    try {
      await fs.unlink(targetFile);
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  public async pruneExpired(now: number = Date.now()): Promise<number> {
    let prunedCount = 0;
    try {
      const files = await fs.readdir(this.baseDirectory);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = path.join(this.baseDirectory, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const parsed = JSON.parse(content) as SeoCheckpoint;
          if (parsed && typeof parsed.expiresAt === "number" && parsed.expiresAt <= now) {
            await fs.unlink(filePath).catch(() => {});
            prunedCount++;
          }
        } catch {
          // If file is corrupted or unreadable, ignore during pruning
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "ENOENT") {
        return 0;
      }
      throw err;
    }
    return prunedCount;
  }
}
