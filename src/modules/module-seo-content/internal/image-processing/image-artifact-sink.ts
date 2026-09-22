import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ImageArtifactLocation } from "./image-processing-types";

export interface ImageArtifactSink {
  save(filename: string, webp: Buffer): Promise<ImageArtifactLocation>;
}

/**
 * Stores artifacts in memory.
 */
export class MemoryImageSink implements ImageArtifactSink {
  private readonly store = new Map<string, Buffer>();

  async save(filename: string, webp: Buffer): Promise<ImageArtifactLocation> {
    this.store.set(filename, webp);
    return { data: webp };
  }

  get(filename: string): Buffer | undefined {
    return this.store.get(filename);
  }

  has(filename: string): boolean {
    return this.store.has(filename);
  }
}

/**
 * Writes WebP image artifacts to the filesystem atomically with path traversal guards.
 */
export class FileSystemImageSink implements ImageArtifactSink {
  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = path.resolve(outputDir);
  }

  async save(filename: string, webp: Buffer): Promise<ImageArtifactLocation> {
    if (
      !filename ||
      filename.includes("..") ||
      path.isAbsolute(filename) ||
      path.basename(filename) !== filename
    ) {
      throw new Error(`Path traversal detected for filename: ${filename}`);
    }

    const safeBasename = path.basename(filename);
    const targetPath = path.join(this.outputDir, safeBasename);

    // Verify target path remains under configured directory
    const normalizedTarget = path.normalize(targetPath);
    const normalizedDir = path.normalize(this.outputDir);
    if (!normalizedTarget.startsWith(normalizedDir)) {
      throw new Error(`Path traversal detected for filename: ${filename}`);
    }

    await fs.mkdir(this.outputDir, { recursive: true });

    // Atomic write: write to unique temp file first, then rename
    const randomSuffix = crypto.randomBytes(6).toString("hex");
    const tempPath = `${targetPath}.${randomSuffix}.tmp`;

    await fs.writeFile(tempPath, webp);
    await fs.rename(tempPath, targetPath);

    return {
      localFilePath: targetPath,
      data: webp,
    };
  }
}
