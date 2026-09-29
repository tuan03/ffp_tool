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

test("pinterest login launcher scripts are available for worker machines", async () => {
  const [batLogin, shLogin] = await Promise.all([
    readFile("dang-nhap-pinterest.bat", "utf8"),
    readFile("scripts/login-pinterest.sh", "utf8"),
  ]);

  assert.match(batLogin, /pinterest_browser_login\.py/);
  assert.match(shLogin, /pinterest_browser_login\.py/);
});

test("server and client deployment assets are properly configured", async () => {
  const [
    serverDocker,
    clientNginx,
    compose,
    supervisor,
    pipelineWorker,
    dockerIgnore,
    coordinator,
    pinterestServer,
  ] = await Promise.all([
    readFile("deploy/server/Dockerfile", "utf8"),
    readFile("deploy/client/nginx.conf", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("deploy/server/supervisord.conf", "utf8"),
    readFile("deploy/server/run-pipeline-worker.sh", "utf8"),
    readFile(".dockerignore", "utf8"),
    readFile("src/modules/amazon-crawler/engine/distributed/coordinator_server.py", "utf8"),
    readFile("src/modules/pinterest-pod/server/server.py", "utf8"),
  ]);

  assert.match(serverDocker, /node:22-bookworm-slim/);
  assert.match(serverDocker, /python3/);
  assert.match(serverDocker, /deploy\/server\/entrypoint\.sh/);
  assert.match(serverDocker, /playwright install --with-deps chromium/);
  assert.match(serverDocker, /EXPOSE 3001 8766 8768/);

  assert.match(supervisor, /\[program:pinterest-pod\]/);
  assert.match(supervisor, /server\/server\.py/);
  assert.match(supervisor, /\[program:pipeline-worker\]/);
  assert.match(pipelineWorker, /exec sleep infinity/);

  assert.match(dockerIgnore, /^\*\*\/\.env$/m);
  assert.match(dockerIgnore, /^\*\*\/\.pinterest_oauth_tokens\.json$/m);
  assert.match(dockerIgnore, /^src\/modules\/pinterest-pod\/server\/data$/m);
  assert.match(dockerIgnore, /^src\/modules\/pinterest-pod\/server\/pinterest\/\.pinterest_browser_profile$/m);

  assert.match(clientNginx, /proxy_pass http:\/\/server:3001/);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8766/);
  assert.match(clientNginx, /location \^~ \/api\/pinterest-pod\//);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8768/);
  assert.match(clientNginx, /location = \/api\/pinterest-pod\/handover-seo/);
  assert.match(clientNginx, /location = \/api\/pinterest-pod\/sync-shopify/);
  assert.match(clientNginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(clientNginx, /install-agent\.ps1/);

  assert.match(compose, /PINTEREST_POD_PORT:\s*8768/);
  assert.match(compose, /PINTEREST_RUNTIME_ROOT:\s*\/app\/\.runtime\/pinterest-pod/);
  assert.match(compose, /PINTEREST_APP_ID:\s*\$\{PINTEREST_APP_ID:-\}/);
  assert.match(compose, /PINTEREST_APP_SECRET:\s*\$\{PINTEREST_APP_SECRET:-\}/);
  assert.match(compose, /PINTEREST_REDIRECT_URI:\s*\$\{PINTEREST_REDIRECT_URI:-\}/);
  assert.match(compose, /PINTEREST_OAUTH_STATE_SECRET:\s*\$\{PINTEREST_OAUTH_STATE_SECRET:-\}/);
  assert.doesNotMatch(compose, /^\s*-\s*["'][^"'\r\n]*:8768["']\s*$/m);
  assert.doesNotMatch(coordinator, /@app\.(?:get|post|put|delete)\("\/api\/pinterest-pod/);
  assert.doesNotMatch(pinterestServer, /path in \{[^\n]*\/api\/pinterest-pod\/handover-seo/);
});
