import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deployment allows cold startup without bypassing service readiness', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(compose, /start_period: 120s/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(workflow, /--wait --wait-timeout 300/);
});
