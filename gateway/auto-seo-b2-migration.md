# Auto SEO B2 local backup migration

This migration copies only `auto_seo_product_backups` from `.local-data/auto-seo.sqlite3` into local PostgreSQL `public.auto_seo_product_backups`. Gateway runtime continues to use SQLite. No SEO Review table is created or copied.

## Run

Use `AUTO_SEO_TEST_DATABASE_URL` for `ffp_tool` on `127.0.0.1:5432/ffp_tool`. The migration checks the URL and connected database identity. Keep the password in a local environment variable, never in the command or source code.

The B1 PostgreSQL schema must exist before dry-run. If it does not, initialize the existing B1 schema using `AutoSeoPostgresRepository.initializeSchema()` for `public`. This creates only the Auto SEO backup table and indexes.

```powershell
node --disable-warning=ExperimentalWarning --import tsx gateway/auto-seo-migrate-local.ts --dry-run
node --disable-warning=ExperimentalWarning --import tsx gateway/auto-seo-migrate-local.ts
node --disable-warning=ExperimentalWarning --import tsx gateway/auto-seo-migrate-local.ts
```

The first command prints source schema, index and count inspection, target count, planned inserts, existing matches and conflicts without writing PostgreSQL. Preflight checks the actual ordered columns, `UNIQUE` flag and `partial` flag of SQLite indexes; it requires full-table unique `backup_id` and unique `(workflow_id, store_id, product_id)`. Partial unique indexes do not satisfy either requirement. Missing keys stop the command before any PostgreSQL write. The second command repeats preflight, inserts in one transaction, verifies every source backup field in that transaction and again after commit. The third command proves idempotency: zero inserts, all source IDs already present, zero conflicts.

The source is opened read-only. Missing nullable source columns such as `gpt_settings_json` map to PostgreSQL `NULL`. Required missing columns stop migration. `snapshot_json`, SHA, timestamps and other fields are copied as stored. A target row with the same `backup_id` and different data stops migration. A different `backup_id` with the same `(workflow_id, store_id, product_id)` is reported as a conflict before writing. Any failure before COMMIT rolls back the transaction. If the defense-in-depth verification after COMMIT fails, the command reports that the transaction committed and that the target needs manual investigation; it does not claim rollback.

The CLI compares SQLite database content hash, database/WAL existence, size, mtime and hash, source row count, column list, and ordered unique index definitions including the partial flag. Its final fingerprint is captured after the final SQLite preflight read, with no further SQLite access. The SQLite SHM file is excluded because readers can change its lock metadata. Database content hash, schema, unique index definitions, and row count are authoritative. The report never prints snapshots, hashes, or credentials.

If the source changes before PostgreSQL COMMIT, migration raises `AUTO_SEO_SOURCE_CHANGED_DURING_MIGRATION` and rolls back. If it changes after COMMIT, the CLI raises `AUTO_SEO_MIGRATION_COMMITTED_SOURCE_CHANGED`, exits non-zero and states that committed rows may exist. It reports `sourceUnchanged: false` and `cutoverSafe: false`; it does not print a successful migration phase or claim rollback. Stop or quiesce SQLite writers, then rerun preflight and migration verification before considering cutover.

Run the integration tests with `AUTO_SEO_TEST_DATABASE_URL` set:

```powershell
node_modules\.bin\tsx.cmd --test gateway\__tests__\auto-seo-migration.test.ts gateway\__tests__\auto-seo-postgres-repository.test.ts
```
