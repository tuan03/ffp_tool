import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function prepareEnvironment(t, incoming, previous = "", extraArgs = []) {
  const directory = await mkdtemp(join(tmpdir(), "ffp-postgres-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = join(directory, ".env");
  const previousPath = join(directory, "previous.env");
  await writeFile(envPath, incoming);
  await writeFile(previousPath, previous);
  const command = spawnSync("python", [
    "scripts/prepare-production-postgres.py",
    "--env-file", envPath,
    "--previous-env-file", previousPath,
    ...extraArgs,
  ], { encoding: "utf8" });
  return { command, contents: await readFile(envPath, "utf8") };
}

test("production Compose persists PostgreSQL 17 and waits before starting the existing app", async () => {
  const compose = await readFile("compose.prod.yaml", "utf8");
  assert.match(compose, /database:\s*\n\s*image: postgres:17-alpine/);
  assert.match(compose, /ffp_postgres_data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /^name: ffp-tool$/m);
  assert.match(compose, /volumes:\s*\n\s*ffp_postgres_data:\s*$/);
  assert.match(compose, /depends_on:\s*\n\s*database:\s*\n\s*condition: service_healthy/);
  assert.match(compose, /AUTO_SEO_DATABASE_URL:/);
  assert.match(compose, /pg_isready/);
  assert.match(compose, /\.\/data:\/app\/\.local-data/);
  assert.match(compose, /\.\/runtime:\/app\/\.runtime/);
  const databaseSection = compose.split("  app:")[0];
  assert.doesNotMatch(databaseSection, /ports:/);
  assert.doesNotMatch(compose, /^\s*POSTGRES_PASSWORD:.*:-/m);
});

test("production deployment transfers Compose from Git instead of regenerating an app-only file", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  const deployJob = workflow.slice(workflow.indexOf("  deploy:"));
  assert.match(deployJob, /uses: actions\/checkout@v4/);
  assert.match(deployJob, /base64 -w 0 compose\.prod\.yaml/);
  assert.match(deployJob, /"\$COMPOSE_B64" \| base64 -d > compose\.prod\.yaml/);
  assert.doesNotMatch(deployJob, /"services:"/);
  assert.match(deployJob, /prepare-production-postgres\.py/);
  assert.match(deployJob, /docker volume inspect ffp-tool_ffp_postgres_data/);
  assert.match(deployJob, /set -Eeuo pipefail/);
});

test("PostgreSQL setup preserves VPS credentials despite stale deployment secrets", async t => {
  const previous = "POSTGRES_DB=existing_db\nPOSTGRES_USER=existing_user\nPOSTGRES_PASSWORD='previous-p@ss$word'\n";
  const { command, contents } = await prepareEnvironment(t,
    "STORE_TEST_CLIENT_SECRET=keep-store-secret\nPOSTGRES_PASSWORD=stale-password\n", previous);
  assert.equal(command.status, 0, command.stderr);
  assert.match(contents, /STORE_TEST_CLIENT_SECRET=keep-store-secret/);
  assert.match(contents, /POSTGRES_PASSWORD='previous-p@ss\$word'/);
  assert.match(contents, /AUTO_SEO_DATABASE_URL='postgresql:\/\/existing_user:previous-p%40ss%24word@database:5432\/existing_db'/);
  assert.doesNotMatch(contents, /stale-password/);
  assert.doesNotMatch(command.stdout + command.stderr, /previous-p|keep-store-secret/);
});

test("PostgreSQL setup creates credentials only for a new volume and remains stable on redeploy", async t => {
  const first = await prepareEnvironment(t, "APP_PORT=3010\n");
  assert.equal(first.command.status, 0, first.command.stderr);
  const password = first.contents.match(/POSTGRES_PASSWORD='([a-f0-9]{64})'/)?.[1];
  assert.ok(password);
  assert.match(first.contents, /POSTGRES_DB='ffp_tool'/);
  assert.match(first.contents, /POSTGRES_USER='ffp_tool'/);
  assert.doesNotMatch(first.command.stdout + first.command.stderr, new RegExp(password));
  const second = await prepareEnvironment(t, "APP_PORT=3010\n", first.contents, ["--has-existing-volume"]);
  assert.equal(second.command.status, 0, second.command.stderr);
  assert.equal(second.contents, first.contents);
});

test("PostgreSQL setup refuses to rotate a missing password on an existing data volume", async t => {
  const incoming = "APP_PORT=3010\n";
  const { command, contents } = await prepareEnvironment(t, incoming, "", ["--has-existing-volume"]);
  assert.notEqual(command.status, 0);
  assert.match(command.stderr, /existing PostgreSQL volume/);
  assert.equal(contents, incoming);
});

test("PostgreSQL setup preserves an explicit connection URL", async t => {
  const previous = "POSTGRES_PASSWORD=previous-password\nAUTO_SEO_DATABASE_URL='postgresql://external.example/seo'\nDATABASE_URL='postgresql://external.example/other'\n";
  const { command, contents } = await prepareEnvironment(t, "POSTGRES_PASSWORD=stale-password\n", previous);
  assert.equal(command.status, 0, command.stderr);
  assert.match(contents, /AUTO_SEO_DATABASE_URL='postgresql:\/\/external.example\/seo'/);
  assert.match(contents, /DATABASE_URL='postgresql:\/\/external.example\/other'/);
});

test("PostgreSQL setup retains DATABASE_URL as the gateway connection when no Auto SEO URL was configured", async t => {
  const previous = "POSTGRES_PASSWORD=previous-password\nDATABASE_URL='postgresql://external.example/seo'\n";
  const { command, contents } = await prepareEnvironment(t, "", previous);
  assert.equal(command.status, 0, command.stderr);
  assert.match(contents, /AUTO_SEO_DATABASE_URL='postgresql:\/\/external.example\/seo'/);
});

test("PostgreSQL setup rejects unsafe dotenv characters without leaking credentials", async t => {
  const incoming = "POSTGRES_PASSWORD=invalid'password\n";
  const { command, contents } = await prepareEnvironment(t, incoming);
  assert.notEqual(command.status, 0);
  assert.doesNotMatch(command.stdout + command.stderr, /invalid'password/);
  assert.equal(contents, incoming);
});
