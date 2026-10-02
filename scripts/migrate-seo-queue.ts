import { getAutoSeoDatabaseUrl } from "../gateway/auto-seo-database-url";
import { migrateSeoQueue } from "../gateway/custom-gpt-seo/postgres-migration";
import { migrateAutoSeoBackups } from "../gateway/auto-seo-migration";
import { migrateAutoSeoReviewsLocal } from "../gateway/auto-seo-review-migration";

const arguments_ = process.argv.slice(2);
const sourcePath = arguments_[arguments_.indexOf("--source") + 1];
const schemaIndex = arguments_.indexOf("--schema");
const autoSeoSourceIndex = arguments_.indexOf("--auto-seo-source");
const databaseUrl = getAutoSeoDatabaseUrl();
if (!arguments_.includes("--confirm-quiesced") || !arguments_.includes("--source") || !sourcePath || sourcePath.startsWith("--") || !databaseUrl) {
  console.error("Usage: stop every legacy Gateway/worker, then run migrate-seo-queue.ts --source <SQLite backup> --confirm-quiesced [--schema <target>] [--auto-seo-source <legacy Auto SEO backup>]. Configure AUTO_SEO_DATABASE_URL or DATABASE_URL privately.");
  process.exitCode = 1;
} else {
  try {
    if (schemaIndex >= 0 && (!arguments_[schemaIndex + 1] || arguments_[schemaIndex + 1]?.startsWith("--"))) throw new Error("A schema identifier is required");
    if (autoSeoSourceIndex >= 0) {
      const autoSeoSource = arguments_[autoSeoSourceIndex + 1];
      if (!autoSeoSource || autoSeoSource.startsWith("--")) throw new Error("A legacy Auto SEO source is required");
      const options = { sourcePath: autoSeoSource, databaseUrl, allowProductionTarget: true, ...(schemaIndex >= 0 ? { schema: arguments_[schemaIndex + 1] } : {}) };
      const preflight = await migrateAutoSeoBackups({ ...options, dryRun: true });
      if (preflight.conflicts) throw new Error("Legacy Auto SEO backup conflicts require manual review");
      const backups = await migrateAutoSeoBackups(options);
      console.log(JSON.stringify({ phase: "legacy-backups", inserted: backups.inserted, migratedCount: backups.migratedCount, mismatches: backups.mismatches }));
      console.log(JSON.stringify({ phase: "legacy-reviews", ...await migrateAutoSeoReviewsLocal({ ...options, allowEquivalentHistoricalBackup: true }) }));
    }
    const report = await migrateSeoQueue({ sourcePath, databaseUrl, ...(schemaIndex >= 0 ? { schema: arguments_[schemaIndex + 1] } : {}) });
    console.log(JSON.stringify(report));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]"));
    process.exitCode = 1;
  }
}
