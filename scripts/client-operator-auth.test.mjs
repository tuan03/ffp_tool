import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("merged client preserves worker and review routes without duplicating static cache", async () => {
  const nginxConfig = await readFile("deploy/client/nginx.conf", "utf8");
  for (const route of ["location = /mcp/seo-worker", "location ^~ /api/seo-agent/", "location ^~ /seo-agent-pack/", "location ^~ /api/v1/pinterest-assets/", "location = /api/review-images/extension"]) {
    assert.equal(nginxConfig.split(route).length - 1, 1, route);
  }
  assert.equal(nginxConfig.split('expires 1M;').length - 1, 1);
  const server = await readFile("gateway/server.ts", "utf8");
  assert.match(server, /if \(url.startsWith\("\/api\/review-images\/"\)\) \{[\s\S]*?handleReviewImageHttpRequest[\s\S]*?return;\s+\}\s+if \(url.startsWith\("\/api\/seo-agent\/"\)\) \{/);
});

test("production client challenges operators before serving the SPA and protected APIs", async () => {
  const nginxConfig = await readFile("deploy/client/nginx.conf", "utf8");

  assert.match(
    nginxConfig,
    /location \/ \{\s+auth_basic "FFP Tool";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;\s+try_files/s,
  );
  assert.match(
    nginxConfig,
    /location \^~ \/api\/seo-performance\/ \{\s+auth_basic "FFP Tool";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;/s,
  );
  assert.match(
    nginxConfig,
    /location \^~ \/api\/seo-review\/ \{\s+auth_basic "FFP Tool";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;/s,
  );
  assert.match(
    nginxConfig,
    /location \^~ \/api\/v1\/gpt-seo\/admin\/ \{\s+auth_basic "FFP Tool";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;/s,
  );
  assert.match(
    nginxConfig,
    /location ~ \^\/api\/\(shopify\|stores\|auto-seo\|proxy\|review-images\|amazon-reviews\) \{\s+auth_basic "FFP Tool";\s+auth_basic_user_file \/etc\/nginx\/\.htpasswd;/s,
  );
});

test("production client keeps health checks public and separate from protected APIs", async () => {
  const [nginxConfig, compose] = await Promise.all([
    readFile("deploy/client/nginx.conf", "utf8"),
    readFile("docker-compose.yml", "utf8"),
  ]);

  assert.match(
    nginxConfig,
    /location = \/health \{\s+auth_basic off;\s+proxy_pass http:\/\/server:3001;/s,
  );
  assert.doesNotMatch(nginxConfig, /api\/v1\/gpt-seo\|mcp\/gpt-seo\|health/);
  assert.match(
    nginxConfig,
    /location \^~ \/api\/v1\/gpt-seo\/ \{\s+proxy_pass http:\/\/server:3001;/s,
  );
  assert.match(
    nginxConfig,
    /location = \/mcp\/gpt-seo \{\s+proxy_pass http:\/\/server:3001;/s,
  );
  assert.match(compose, /wget -q --spider http:\/\/127\.0\.0\.1\/health/);
  assert.doesNotMatch(compose, /wget -q --spider http:\/\/127\.0\.0\.1\/ \|\| exit 1/);
});

test("production client proxies active crawler operator APIs through the coordinator", async () => {
  const [nginxConfig, crawlerService, deadLetterPanel] = await Promise.all([
    readFile("deploy/client/nginx.conf", "utf8"),
    readFile("src/modules/amazon-crawler/service.ts", "utf8"),
    readFile("src/modules/amazon-crawler/ui/components/AmazonCrawlerDeadLetterPanel.tsx", "utf8"),
  ]);
  const coordinatorRoute = nginxConfig.match(/location ~ \^\/api\/v1\/\(([^)]*)\)\(\/\|\$\)/)?.[1] ?? "";
  for (const route of ["operator", "dead-letter", "crawl-tasks", "admission-gate", "fleet-circuit-breaker", "agent-keys"]) {
    assert.ok(coordinatorRoute.split("|").includes(route), `Nginx must proxy ${route}`);
  }
  assert.match(crawlerService, /api\/v1\/operator\/security/);
  assert.match(crawlerService, /clients\|crawl-jobs\|crawl-tasks[\s\S]*dead-letter[\s\S]*agent-keys/);
  assert.match(deadLetterPanel, /items\.length === 0 && !error/);
});

test("server and client receive operator credentials while only client creates the Nginx password file", async () => {
  const [dockerfile, compose, entrypoint] = await Promise.all([
    readFile("deploy/client/Dockerfile", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("deploy/client/configure-operator-auth.sh", "utf8"),
  ]);

  assert.match(dockerfile, /apk add --no-cache apache2-utils/);
  assert.match(dockerfile, /COPY deploy\/client\/configure-operator-auth\.sh \/docker-entrypoint\.d\/10-configure-operator-auth\.sh/);
  assert.match(dockerfile, /chmod 755 \/docker-entrypoint\.d\/10-configure-operator-auth\.sh/);

  const serverService = compose.slice(compose.indexOf("  server:"), compose.indexOf("  client:"));
  const clientService = compose.slice(compose.indexOf("  client:"));
  assert.match(serverService, /FFP_OPERATOR_USERNAME: \$\{FFP_OPERATOR_USERNAME:\?/);
  assert.match(serverService, /FFP_OPERATOR_PASSWORD: \$\{FFP_OPERATOR_PASSWORD:\?/);
  assert.match(serverService, /PINTEREST_COORDINATOR_OPERATOR_USERNAME: \$\{FFP_OPERATOR_USERNAME:\?/);
  assert.match(serverService, /PINTEREST_COORDINATOR_OPERATOR_PASSWORD: \$\{FFP_OPERATOR_PASSWORD:\?/);
  assert.match(clientService, /FFP_OPERATOR_USERNAME: \$\{FFP_OPERATOR_USERNAME:\?/);
  assert.match(clientService, /FFP_OPERATOR_PASSWORD: \$\{FFP_OPERATOR_PASSWORD:\?/);
  assert.doesNotMatch(clientService, /GATEWAY_AUTH_TOKEN/);

  assert.match(entrypoint, /FFP_OPERATOR_USERNAME/);
  assert.match(entrypoint, /FFP_OPERATOR_PASSWORD/);
  assert.match(entrypoint, /htpasswd -i -c -B/);
  assert.match(entrypoint, /chmod 600 \/etc\/nginx\/\.htpasswd/);
  assert.doesNotMatch(entrypoint, /GATEWAY_AUTH_TOKEN/);
});
