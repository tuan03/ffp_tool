import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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
  const nginxConfig = await readFile("deploy/client/nginx.conf", "utf8");

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
});

test("client container creates its password file from operator credentials without receiving the gateway token", async () => {
  const [dockerfile, compose, entrypoint] = await Promise.all([
    readFile("deploy/client/Dockerfile", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("deploy/client/configure-operator-auth.sh", "utf8"),
  ]);

  assert.match(dockerfile, /apk add --no-cache apache2-utils/);
  assert.match(dockerfile, /COPY deploy\/client\/configure-operator-auth\.sh \/docker-entrypoint\.d\/10-configure-operator-auth\.sh/);
  assert.match(dockerfile, /chmod 755 \/docker-entrypoint\.d\/10-configure-operator-auth\.sh/);

  const clientService = compose.slice(compose.indexOf("  client:"));
  assert.match(clientService, /FFP_OPERATOR_USERNAME: \$\{FFP_OPERATOR_USERNAME:\?/);
  assert.match(clientService, /FFP_OPERATOR_PASSWORD: \$\{FFP_OPERATOR_PASSWORD:\?/);
  assert.doesNotMatch(clientService, /GATEWAY_AUTH_TOKEN/);

  assert.match(entrypoint, /FFP_OPERATOR_USERNAME/);
  assert.match(entrypoint, /FFP_OPERATOR_PASSWORD/);
  assert.match(entrypoint, /htpasswd -i -c -B/);
  assert.match(entrypoint, /chmod 600 \/etc\/nginx\/\.htpasswd/);
  assert.doesNotMatch(entrypoint, /GATEWAY_AUTH_TOKEN/);
});
