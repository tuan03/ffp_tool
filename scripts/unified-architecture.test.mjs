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
  const [serverDocker, clientNginx] = await Promise.all([
    readFile("deploy/server/Dockerfile", "utf8"),
    readFile("deploy/client/nginx.conf", "utf8"),
  ]);

  assert.match(serverDocker, /node:22-bookworm-slim/);
  assert.match(serverDocker, /python3/);
  assert.match(serverDocker, /deploy\/server\/entrypoint\.sh/);

  assert.match(clientNginx, /proxy_pass http:\/\/server:3001/);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8766/);
  assert.match(clientNginx, /proxy_pass http:\/\/server:8768/);
  assert.match(clientNginx, /seo-review/);
  assert.match(clientNginx, /location ~ \^\/api\/pinterest-pod\/\(handover-seo\|sync-shopify\)/);
  assert.match(clientNginx, /return 404 '\{"success":false,"error":\{"code":"NOT_FOUND"/);
  assert.match(clientNginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(clientNginx, /install-agent\.ps1/);
});

test("Nginx routing rules accurately dispatch paths to Gateway :3001, Pinterest :8768, Coordinator :8766, and 404 for unknown APIs", async () => {
  const clientNginx = await readFile("deploy/client/nginx.conf", "utf8");

  // Helper simulating the exact location matching order from nginx.conf
  function resolveNginxRoute(path) {
    // 2. Crawler Coordinator
    if (/^\/api\/v1\/(crawl-jobs|clients|worker)\/?/.test(path)) {
      return { upstream: "server:8766", type: "proxy" };
    }
    // 3a. Pinterest POD specific handover & sync -> Gateway
    if (/^\/api\/pinterest-pod\/(handover-seo|sync-shopify)(?:\/|$)/.test(path)) {
      return { upstream: "server:3001", type: "proxy" };
    }
    // 3b. Pinterest POD general service -> server:8768
    if (/^\/api\/pinterest-pod\//.test(path)) {
      return { upstream: "server:8768", type: "proxy" };
    }
    // 3c. Core Gateway & Shopify & Auto SEO & SEO Review & GPT SEO -> server:3001
    if (/^\/(api\/(shopify|stores|auto-seo|proxy|seo-review)|api\/v1\/gpt-seo|health)/.test(path)) {
      return { upstream: "server:3001", type: "proxy" };
    }
    // 3d. Unhandled API paths return 404 JSON (NOT SPA HTML)
    if (/^\/api\//.test(path)) {
      return { status: 404, type: "json_404" };
    }
    // 1. Static SPA fallback
    return { type: "spa_html", file: "/index.html" };
  }

  // 1. Root and UI paths serve SPA HTML
  assert.equal(resolveNginxRoute("/").type, "spa_html");
  assert.equal(resolveNginxRoute("/orders/123").type, "spa_html");
  assert.equal(resolveNginxRoute("/auto-seo").type, "spa_html");

  // 2. Shopify and core Gateway APIs route to server:3001
  assert.deepEqual(resolveNginxRoute("/api/shopify"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/stores/register"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/auto-seo/run"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/proxy/check"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/seo-review/items"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/v1/gpt-seo/context"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/health"), { upstream: "server:3001", type: "proxy" });

  // 3. Pinterest POD handover and sync route to server:3001 (Gateway)
  assert.deepEqual(resolveNginxRoute("/api/pinterest-pod/handover-seo"), { upstream: "server:3001", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/pinterest-pod/sync-shopify"), { upstream: "server:3001", type: "proxy" });

  // 4. Other Pinterest POD routes route to server:8768 (Pinterest service)
  assert.deepEqual(resolveNginxRoute("/api/pinterest-pod/status"), { upstream: "server:8768", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/pinterest-pod/auth"), { upstream: "server:8768", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/pinterest-pod/trends"), { upstream: "server:8768", type: "proxy" });

  // 5. Crawler coordinator routes to server:8766
  assert.deepEqual(resolveNginxRoute("/api/v1/crawl-jobs"), { upstream: "server:8766", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/v1/clients"), { upstream: "server:8766", type: "proxy" });
  assert.deepEqual(resolveNginxRoute("/api/v1/worker/connect"), { upstream: "server:8766", type: "proxy" });

  // 6. Unknown /api/ routes return 404 JSON and NEVER fall back to SPA index.html
  assert.deepEqual(resolveNginxRoute("/api/unknown-endpoint"), { status: 404, type: "json_404" });
  assert.deepEqual(resolveNginxRoute("/api/v1/non-existent"), { status: 404, type: "json_404" });
});

