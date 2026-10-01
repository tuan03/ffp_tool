import type {
  AutoSeoPostgresBackup,
  AutoSeoPostgresBackupInput,
  AutoSeoPostgresClaimResult,
  AutoSeoPostgresInsertOptions,
} from "./auto-seo-postgres-repository";

/** The backup batch is committed before callers start downstream SEO work. */
export interface AutoSeoBackupRepository {
  claimEligibleBatch(records: readonly AutoSeoPostgresBackupInput[], options?: AutoSeoPostgresInsertOptions): Promise<AutoSeoPostgresClaimResult>;
  insertBackupBatch(records: readonly AutoSeoPostgresBackupInput[], options?: AutoSeoPostgresInsertOptions): Promise<void>;
  findByBackupId(backupId: string): Promise<AutoSeoPostgresBackup | null>;
  findByStoreAndProductIds(storeId: string, productIds: readonly string[]): Promise<readonly AutoSeoPostgresBackup[]>;
  findPendingBackups(limit?: number): Promise<readonly AutoSeoPostgresBackup[]>;
  updateDownstreamStatus(workflowId: string, backupIds: readonly string[], status: "SENT" | "FAILED", httpStatus?: number | null, error?: string | null): Promise<void>;
  acknowledgePendingHandoff(backupId: string): Promise<void>;
  failPendingHandoff(backupId: string, error: string): Promise<void>;
}
