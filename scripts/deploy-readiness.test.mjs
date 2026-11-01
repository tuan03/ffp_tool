import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deployment allows cold startup without bypassing service readiness', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(compose, /start_period: 120s/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(workflow, /--wait --wait-timeout 300/);
  assert.match(compose, /python .*pipeline_health\.py/);
  assert.match(workflow, /docker exec ffp-server python .*pipeline_health\.py/);
});

test('client proxy sends Etsy operator endpoints to Coordinator without opening internal routes', () => {
  const nginx = readFileSync('deploy/client/nginx.conf', 'utf8');
  const route = nginx.match(/location ~ (\^\/api\/v1\/[^\s]+) \{/);
  assert.ok(route, 'Coordinator route allowlist must exist');
  const matcher = new RegExp(route[1]);
  for (const path of ['/api/v1/etsy/auth/status', '/api/v1/etsy/auth/credentials', '/api/v1/etsy-listings/resolve']) {
    assert.equal(matcher.test(path), true, path);
  }
  assert.equal(matcher.test('/api/v1/internal/product-pipeline'), false);
  assert.equal(matcher.test('/api/v1/etsy-not-a-route'), false);
  assert.match(nginx, /location \^~ \/api\/v1\/internal\/[\s\S]*?return 404/);
});
