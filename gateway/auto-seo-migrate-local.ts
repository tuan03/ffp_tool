import path from "node:path";
import { pathToFileURL } from "node:url";

import { captureAutoSeoSourceState, isAutoSeoSourceUnchanged, migrateAutoSeoBackups } from "./auto-seo-migration";
import type { MigrationOptions, MigrationReport } from "./auto-seo-migration";

export async function runAutoSeoMigrationLocal(
  options: MigrationOptions,
  printReport: (message: string) => void = console.log,
): Promise<void> {
  const sourceBefore = captureAutoSeoSourceState(options.sourcePath);
  let migrationError: unknown;
  let migrated: MigrationReport | undefined;
  try {
    const preflight = await migrateAutoSeoBackups({ ...options, dryRun: true });
    printReport(JSON.stringify({ phase: "preflight", ...preflight }, null, 2));
    if (preflight.conflicts) throw new Error(`Aborting: ${preflight.conflicts} target conflict(s)`);
    if (!options.dryRun) migrated = await migrateAutoSeoBackups(options);
  } catch (error) {
    migrationError = error;
  }

  let sourceUnchanged = false;
  try {
    // This must be the final access to SQLite and its database/WAL files.
    const sourceAfter = captureAutoSeoSourceState(options.sourcePath);
    sourceUnchanged = isAutoSeoSourceUnchanged(sourceBefore, sourceAfter);
  } catch {
    // A changed or unreadable source cannot be certified safe for cutover.
  }
  const targetCommitted = migrated?.committed === true ||
    (migrationError instanceof Error && migrationError.message.includes("AUTO_SEO_MIGRATION_COMMITTED_POST_VERIFY_FAILED"));
  printReport(JSON.stringify({ sourceUnchanged, cutoverSafe: sourceUnchanged && !migrationError, targetCommitted,
    seoReviewMigrated: false, runtimeCutover: false }, null, 2));

  if (!sourceUnchanged) {
    const code = targetCommitted ? "AUTO_SEO_MIGRATION_COMMITTED_SOURCE_CHANGED" : "AUTO_SEO_SOURCE_CHANGED_DURING_MIGRATION";
    throw new Error(`${code}: SQLite source changed while migration was running; target may already contain committed rows. Do not cut over; stop or quiesce writers and rerun preflight and migration verification.`, { cause: migrationError });
  }
  if (migrationError) throw migrationError;
  if (migrated) printReport(JSON.stringify({ phase: "migration", ...migrated }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--dry-run")) throw new Error("Only --dry-run is supported");
  await runAutoSeoMigrationLocal({
    sourcePath: path.resolve(".local-data/auto-seo.sqlite3"),
    databaseUrl,
    dryRun: args.includes("--dry-run"),
  });
}
