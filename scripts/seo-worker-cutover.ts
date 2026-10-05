/** Operator CLI only. Credentials come from server environment, never argv or logs. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, open, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { PostgresCustomGptQueue } from "../gateway/custom-gpt-seo/postgres-queue";

const manifestSchema = z.object({ storeId: z.string(), schema: z.string(), databaseIdentity: z.string(), fingerprint: z.string(), sha256: z.string(), restored: z.boolean() }).strict();
const [command = "inspect", storeId, backupArgument] = process.argv.slice(2);
const url = process.env.AUTO_SEO_DATABASE_URL ?? process.env.DATABASE_URL;
const operator = process.env.SEO_WORKER_OPERATOR;
const schema = process.env.SEO_WORKER_SCHEMA ?? "public";

async function pgTool(name: string, args: string[], databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  await new Promise<void>((done, reject) => {
    const child = spawn(name, args, { env: { ...process.env, PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
      PGHOST: target.hostname, PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password),
      PGSSLMODE: target.searchParams.get("sslmode") ?? process.env.PGSSLMODE ?? "prefer" }, stdio: "ignore", windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("POSTGRES_TOOL_TIMEOUT")); }, 120_000);
    child.once("close", () => clearTimeout(timeout));
    child.on("error", () => reject(new Error("POSTGRES_TOOL_UNAVAILABLE")));
    child.on("exit", code => code === 0 ? done() : reject(new Error("POSTGRES_TOOL_FAILED")));
  });
}
async function run(): Promise<void> {
  if (!url || !operator || !storeId || !/^[a-zA-Z0-9_-]{1,100}$/.test(storeId) || !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("CONFIGURATION_REQUIRED");
  if (!["inspect", "drain", "backup", "verify", "apply"].includes(command)) throw new Error("INVALID_COMMAND");
  const identity = new URL(url);
  const databaseIdentity = createHash("sha256").update(`${identity.hostname}:${identity.port}/${identity.pathname}/${schema}`).digest("hex");
  const queue = new PostgresCustomGptQueue({ databaseUrl: url, schema });
  try {
    await queue.initialize();
    if (command === "drain") { await queue.cutover.drain(storeId, operator); console.log(JSON.stringify(await queue.cutover.inspect(storeId))); return; }
    const report = await queue.cutover.inspect(storeId);
    if (command === "inspect") { console.log(JSON.stringify(report)); return; }
    if (!backupArgument) throw new Error("BACKUP_PATH_REQUIRED");
    const backup = resolve(backupArgument);
    const manifestPath = `${backup}.manifest.json`;
    if (command === "backup") {
      if (!report.draining) throw new Error("CUTOVER_NOT_DRAINING");
      // Exclusive creation protects existing operator backups. Restrictive mode before pg_dump writes.
      const handle = await open(backup, "wx", 0o600); await handle.close();
      await pgTool("pg_dump", ["--format=custom", `--schema=${schema}`, `--file=${backup}`], url);
      await pgTool("pg_restore", ["--list", backup], url);
      if ((await queue.cutover.inspect(storeId)).fingerprint !== report.fingerprint) throw new Error("BACKUP_STALE");
      const sha256 = createHash("sha256").update(await readFile(backup)).digest("hex");
      await writeFile(manifestPath, JSON.stringify({ storeId, schema, databaseIdentity, fingerprint: report.fingerprint, sha256, restored: false }), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ status: "BACKUP_CREATED_RESTORE_CHECK_REQUIRED", bytes: (await stat(backup)).size, sha256 })); return;
    }
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (manifest.storeId !== storeId || manifest.schema !== schema || manifest.databaseIdentity !== databaseIdentity) throw new Error("BACKUP_SCOPE_MISMATCH");
    if (createHash("sha256").update(await readFile(backup)).digest("hex") !== manifest.sha256) throw new Error("BACKUP_CHECKSUM_MISMATCH");
    if (command === "verify") {
      const testUrl = process.env.SEO_WORKER_RESTORE_TEST_DATABASE_URL;
      if (!testUrl || testUrl === url) throw new Error("EMPTY_RESTORE_DATABASE_REQUIRED");
      const sourceTarget = new URL(url), restoreTarget = new URL(testUrl);
      if (sourceTarget.host === restoreTarget.host && sourceTarget.pathname === restoreTarget.pathname) throw new Error("EMPTY_RESTORE_DATABASE_REQUIRED");
      const testPool = new Pool({ connectionString: testUrl });
      try {
        const existing = await testPool.query("SELECT 1 FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') LIMIT 1");
        if (existing.rows.length) throw new Error("RESTORE_DATABASE_NOT_EMPTY");
        await pgTool("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname=" + restoreTarget.pathname.slice(1), backup], testUrl);
        const restoredQueue = new PostgresCustomGptQueue({ databaseUrl: testUrl, schema });
        try {
          if ((await restoredQueue.cutover.inspect(storeId)).fingerprint !== manifest.fingerprint || manifest.fingerprint !== report.fingerprint) throw new Error("RESTORE_VERIFICATION_MISMATCH");
        } finally { await restoredQueue.close(); }
      } finally { await testPool.end(); }
      await writeFile(manifestPath, JSON.stringify({ ...manifest, restored: true }), { mode: 0o600 });
      console.log(JSON.stringify({ status: "RESTORE_VERIFIED", sha256: manifest.sha256 })); return;
    }
    if (process.env.SEO_WORKER_CONFIRM_STORE !== storeId || !manifest.restored) throw new Error("VERIFIED_BACKUP_AND_CONFIRMATION_REQUIRED");
    console.log(JSON.stringify({ status: "APPLIED", ...await queue.cutover.apply(storeId, manifest.fingerprint, operator) }));
  } finally { await queue.close(); }
}
run().catch(error => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CUTOVER_FAILED: inspect server configuration; no secret details are printed"); process.exitCode = 1; });
