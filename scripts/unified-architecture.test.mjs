import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("root Compose is the only production topology and publishes only the client", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");
  const legacyComposeFiles = [
    "compose.prod.yaml",
    "deploy/amazon-crawler-coordinator/docker-compose.yml",
  ];

  for (const legacyComposeFile of legacyComposeFiles) {
    await assert.rejects(access(legacyComposeFile));
  }

  assert.match(compose, /client:[\s\S]*?ports:\s*\n\s*-\s*"\$\{CLIENT_BIND_ADDRESS/);
  assert.doesNotMatch(compose, /\$\{POSTGRES_PORT/);
  assert.doesNotMatch(compose, /\$\{GATEWAY_PORT/);
  assert.doesNotMatch(compose, /\$\{COORDINATOR_PORT/);
  assert.doesNotMatch(compose, /^\s*-\s*["'][^"'\r\n]*:(?:3001|5432|8766|8768)["']\s*$/m);
});

test("all production services have bounded resources, rotating logs, and restart policy", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");

  assert.equal((compose.match(/restart:\s*unless-stopped/g) ?? []).length, 3);
  assert.equal((compose.match(/driver:\s*"?json-file"?/g) ?? []).length, 3);
  assert.equal((compose.match(/max-size:\s*"\$\{[A-Z_]+:-10m\}"/g) ?? []).length, 3);
  assert.equal((compose.match(/max-file:\s*"\$\{[A-Z_]+:-3\}"/g) ?? []).length, 3);
  assert.equal((compose.match(/cpus:\s*"\$\{[A-Z_]+:-[^}]+\}"/g) ?? []).length, 3);
  assert.equal((compose.match(/mem_limit:\s*\$\{[A-Z_]+:-[^}]+\}/g) ?? []).length, 3);
  assert.equal((compose.match(/pids_limit:\s*\$\{[A-Z_]+:-[^}]+\}/g) ?? []).length, 3);
});

test("production environment template documents the one-command startup without secrets", async () => {
  const environmentTemplate = await readFile(".env.example", "utf8");
  const deploymentGuide = await readFile("docs/unified-deployment-and-crawler.md", "utf8");

  assert.match(environmentTemplate, /^NODE_ENV=production$/m);
  assert.match(environmentTemplate, /^POSTGRES_PASSWORD=$/m);
  assert.doesNotMatch(environmentTemplate, /ffp_secure_password_change_me/);
  assert.doesNotMatch(environmentTemplate, /^POSTGRES_PORT=/m);
  assert.match(deploymentGuide, /cp \.env\.example \.env/);
  assert.match(deploymentGuide, /docker compose up -d --build/);
  assert.match(deploymentGuide, /docker-compose\.yml[^\n]*production manifest/i);
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

test("client proxy preserves SEO, MCP and review routes alongside Pinterest", async () => {
  const nginx = await readFile("deploy/client/nginx.conf", "utf8");
  assert.match(nginx, /location \^~ \/api\/seo-review\//);
  assert.match(nginx, /mcp\/gpt-seo/);
  assert.match(nginx, /review-images/);
  assert.match(nginx, /amazon-reviews/);
  assert.match(nginx, /location = \/api\/pinterest-pod\/handover-seo/);
  assert.match(nginx, /location = \/api\/pinterest-pod\/sync-shopify/);
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
    readFile("scripts/install-agent-source.ps1", "utf8"),
    readFile("scripts/install-agent.sh", "utf8"),
  ]);

  assert.match(batInstaller, /powershell -NoProfile -ExecutionPolicy Bypass/);
  assert.match(batInstaller, /FFP_SERVER_URL/);
  assert.match(batInstaller, /install-agent\.ps1/);

  assert.match(ps1Installer, /ffp-crawler-agent\.tar\.gz/);
  assert.match(ps1Installer, /Get-FileHash/);
  assert.match(ps1Installer, /amazon-crawler-agent\.py/);
  assert.match(ps1Installer, /playwright install chromium/);
  assert.match(ps1Installer, /amazon-crawler-agent\.json/);
  assert.match(ps1Installer, /chay-agent\.bat/);

  assert.match(shInstaller, /ffp-crawler-agent\.tar\.gz/);
  assert.match(shInstaller, /sha256/);
  assert.match(shInstaller, /amazon-crawler-agent\.py/);
  assert.match(shInstaller, /playwright["\s]+install chromium/);
  assert.match(shInstaller, /amazon-crawler-agent\.json/);
});

test("remote agent package contains runtime source and excludes local Pinterest credentials", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ffp-agent-package-test-"));
  const outputRoot = path.join(temporaryRoot, "package");
  try {
    const packageResult = spawnSync(
      process.execPath,
      ["scripts/package-agent-source.mjs", outputRoot],
      { encoding: "utf8" },
    );
    assert.equal(packageResult.status, 0, packageResult.stderr);
    const manifest = JSON.parse(await readFile(path.join(outputRoot, "agent-package-manifest.json"), "utf8"));
    const packagedPaths = manifest.files.map((file) => file.path);
    assert.ok(packagedPaths.includes("scripts/amazon-crawler-agent.py"));
    assert.ok(packagedPaths.includes("src/modules/amazon-crawler/engine/distributed/client_agent.py"));
    assert.ok(packagedPaths.includes("src/modules/pinterest-pod/server/pinterest_pod_bridge.py"));
    assert.ok(packagedPaths.includes("src/modules/pinterest-pod/server/pinterest/pinterest_browser_login.py"));
    assert.ok(packagedPaths.every((filename) => !filename.includes(".pinterest_browser_profile")));
    assert.ok(packagedPaths.every((filename) => !filename.endsWith(".pinterest_oauth_tokens.json")));
    assert.ok(packagedPaths.every((filename) => !filename.includes("/__pycache__/")));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
    clientDocker,
    clientNginx,
    compose,
    supervisor,
    pipelineWorker,
    dockerIgnore,
    coordinator,
    pinterestServer,
    publicProxy,
  ] = await Promise.all([
    readFile("deploy/server/Dockerfile", "utf8"),
    readFile("deploy/client/Dockerfile", "utf8"),
    readFile("deploy/client/nginx.conf", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("deploy/server/supervisord.conf", "utf8"),
    readFile("deploy/server/run-pipeline-worker.sh", "utf8"),
    readFile(".dockerignore", "utf8"),
    readFile("src/modules/amazon-crawler/engine/distributed/coordinator_server.py", "utf8"),
    readFile("src/modules/pinterest-pod/server/server.py", "utf8"),
    readFile("deploy/custom-gpt-seo/Caddyfile.example", "utf8"),
  ]);

  assert.match(serverDocker, /node:22-bookworm-slim/);
  assert.match(serverDocker, /python3/);
  assert.match(serverDocker, /deploy\/server\/entrypoint\.sh/);
  assert.doesNotMatch(serverDocker, /playwright install --with-deps chromium/);
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
  assert.match(clientNginx, /pinterest-assets/);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8768/);
  assert.match(clientNginx, /location = \/api\/pinterest-pod\/handover-seo/);
  assert.match(clientNginx, /location = \/api\/pinterest-pod\/sync-shopify/);
  assert.match(clientNginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(clientNginx, /install-agent\.ps1/);
  assert.match(clientNginx, /ffp-crawler-agent\.tar\.gz/);
  assert.match(clientNginx, /Content-Disposition.*cai-agent\.bat/);
  assert.match(clientNginx, /FFP_SERVER_URL=.*agent_server_scheme/);
  assert.match(clientDocker, /package-agent-source\.mjs/);
  assert.match(publicProxy, /@agentInstaller path .*\/cai-agent\.bat/);
  assert.match(publicProxy, /handle @agentInstaller \{\s*reverse_proxy 127\.0\.0\.1:3010/);

  assert.match(compose, /PINTEREST_POD_PORT:\s*8768/);
  assert.match(compose, /PINTEREST_COORDINATOR_URL:\s*http:\/\/127\.0\.0\.1:8766/);
  assert.match(compose, /PINTEREST_RUNTIME_ROOT:\s*\/app\/\.runtime\/pinterest-pod/);
  assert.match(compose, /PINTEREST_APP_ID:\s*\$\{PINTEREST_APP_ID:-\}/);
  assert.match(compose, /PINTEREST_APP_SECRET:\s*\$\{PINTEREST_APP_SECRET:-\}/);
  assert.match(compose, /PINTEREST_REDIRECT_URI:\s*\$\{PINTEREST_REDIRECT_URI:-[^}]*\}/);
  assert.match(compose, /PINTEREST_OAUTH_STATE_SECRET:\s*\$\{PINTEREST_OAUTH_STATE_SECRET:-\}/);
  assert.doesNotMatch(compose, /^\s*-\s*["'][^"'\r\n]*:8768["']\s*$/m);
  assert.match(coordinator, /@app\.post\("\/api\/v1\/pinterest-jobs"/);
  assert.match(coordinator, /@app\.post\("\/api\/v1\/pinterest-assets\/\{job_id\}\/\{filename\}"/);
  assert.doesNotMatch(coordinator, /@app\.(?:get|post|put|delete)\("\/api\/pinterest-pod/);
  assert.doesNotMatch(pinterestServer, /path in \{[^\n]*\/api\/pinterest-pod\/handover-seo/);
});
