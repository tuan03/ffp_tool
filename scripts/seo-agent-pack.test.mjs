import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('SEO Agent Pack safe setup, vault restrictions and heartbeat', () => {
  const result = spawnSync('python', ['-m', 'unittest', 'discover', '-s', 'tools/seo-agent-pack', '-p', 'test_helper.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('Agent Pack is deterministic, readable and contains only public files and current schemas', () => {
  const build = () => execFileSync(process.execPath, ['scripts/build-seo-agent-pack.mjs'], { stdio: 'pipe' });
  const archive = 'dist/seo-agent-pack/ffp-seo-worker-1.0.0-preview.zip';
  build();
  const first = readFileSync(archive);
  build();
  assert.deepEqual(readFileSync(archive), first);
  assert.equal(readFileSync(`${archive}.sha256`, 'utf8').split(' ')[0], createHash('sha256').update(first).digest('hex'));
  // Independent ZIP reader validates all CRCs, entry names and UTF-8 JSON.
  const inspection = JSON.parse(execFileSync('python', ['-c',
    'import zipfile,json; z=zipfile.ZipFile("' + archive + '"); assert z.testzip() is None; print(json.dumps({"files":z.namelist(),"schema":json.loads(z.read("resources/submission.schema.json"))}))',
  ], { encoding: 'utf8' }));
  assert.deepEqual(inspection.files, ['ffp_worker.py', 'test_vault_live.py', 'requirements.txt', 'README.md', 'skill/SKILL.md', 'resources/submission.schema.json', 'resources/analysis.schema.json', 'resources/rules.json']);
  const contracts = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/export-seo-worker-contracts.ts'], { encoding: 'utf8' }));
  assert.deepEqual(inspection.schema, contracts.submission);
});
