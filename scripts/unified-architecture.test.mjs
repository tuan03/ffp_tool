import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("docker-compose.yml defines exactly the 3 unified containers: database, server, client", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");

  // Validate all 3 services are defined
  assert.match(compose, /database:\s*\n\s*image:\s*postgres:17-alpine/);
  assert.match(compose, /server:\s*\n\s*build:/);
  assert.match(compose, /client:\s*\n\s*build:/);

  // Database checks
  assert.match(compose, /container_name:\s*ffp-database/);
  assert.match(compose, /pg_isready -U \$\{POSTGRES_USER/);
  assert.match(compose, /ffp_postgres_data:\/var\/lib\/postgresql\/data/);

  // Server checks
  assert.match(compose, /dockerfile:\s*deploy\/server\/Dockerfile/);
  assert.match(compose, /container_name:\s*ffp-server/);
  assert.match(compose, /condition:\s*service_healthy/);
  assert.match(compose, /AMAZON_COORDINATOR_DATABASE_URL:/);
  assert.match(compose, /COORDINATOR_PORT:\s*8766/);

  // Client checks
  assert.match(compose, /dockerfile:\s*deploy\/client\/Dockerfile/);
  assert.match(compose, /container_name:\s*ffp-client/);
  assert.match(compose, /depends_on:\s*\n\s*server:/);
});

test("backup-db scripts perform single-command database backups", async () => {
  const [shScript, ps1Script] = await Promise.all([
    readFile("scripts/backup-db.sh", "utf8"),
    readFile("scripts/backup-db.ps1", "utf8"),
  ]);

  assert.match(shScript, /docker compose exec -T database pg_dump/);
  assert.match(shScript, /gzip >/);
  assert.match(ps1Script, /docker compose exec -T database pg_dump/);
});

test("restore-db scripts perform single-command database restore", async () => {
  const [shScript, ps1Script] = await Promise.all([
    readFile("scripts/restore-db.sh", "utf8"),
    readFile("scripts/restore-db.ps1", "utf8"),
  ]);

  assert.match(shScript, /docker compose exec -T database psql/);
  assert.match(ps1Script, /docker compose exec -T database psql/);
});

test("agent crawler 1-command installer scripts configure dependencies and chromium", async () => {
  const [batInstaller, ps1Installer, shInstaller] = await Promise.all([
    readFile("cai-agent.bat", "utf8"),
    readFile("scripts/install-agent.ps1", "utf8"),
    readFile("scripts/install-agent.sh", "utf8"),
  ]);

  assert.match(batInstaller, /powershell -NoProfile -ExecutionPolicy Bypass/);
  assert.match(batInstaller, /scripts\\install-agent\.ps1/);

  assert.match(ps1Installer, /playwright install chromium/);
  assert.match(ps1Installer, /amazon-crawler-agent\.json/);
  assert.match(ps1Installer, /chay-agent\.bat/);

  assert.match(shInstaller, /playwright["\s]+install chromium/);
  assert.match(shInstaller, /amazon-crawler-agent\.json/);
});

test("server and client deployment assets are properly configured", async () => {
  const [serverDocker, clientNginx] = await Promise.all([
    readFile("deploy/server/Dockerfile", "utf8"),
    readFile("deploy/client/nginx.conf", "utf8"),
  ]);

  assert.match(serverDocker, /node:22-bookworm-slim/);
  assert.match(serverDocker, /python3/);
  assert.match(serverDocker, /deploy\/server\/entrypoint\.sh/);

  assert.match(clientNginx, /proxy_pass http:\/\/server:3001/);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8766/);
  assert.match(clientNginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(clientNginx, /install-agent\.ps1/);
});
