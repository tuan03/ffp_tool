export class SeoConflictCorpusCorruptError extends Error {
  constructor(filePath: string, cause?: unknown) {
    super(`SEO Conflict Corpus file is corrupt or invalid JSON: "${filePath}"`);
    this.name = "SeoConflictCorpusCorruptError";
    if (cause) {
      this.cause = cause;
    }
  }
}

export class CorpusRevisionConflictError extends Error {
  readonly expectedRevision?: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number | undefined, actualRevision: number) {
    super(
      `Corpus revision conflict: expected revision ${expectedRevision}, but current corpus revision is ${actualRevision}. Concurrent modification detected.`,
    );
    this.name = "CorpusRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class CorpusLockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number) {
    super(`Timed out waiting to acquire lock on "${lockPath}" after ${timeoutMs}ms.`);
    this.name = "CorpusLockTimeoutError";
  }
}
