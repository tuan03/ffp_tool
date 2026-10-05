/** Deterministic, uncompressed ZIP of a fixed public allowlist; no runtime directory scans. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'tools', 'seo-agent-pack');
const destination = join(root, 'dist', 'seo-agent-pack');
const contracts = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/export-seo-worker-contracts.ts'], { cwd: root, encoding: 'utf8' }));
const files = ['ffp_worker.py', 'test_vault_live.py', 'requirements.txt', 'README.md', 'skill/SKILL.md'].map(name => {
  const path = join(source, name);
  if (!lstatSync(path).isFile()) throw new Error('PACK_INPUT_MUST_BE_REGULAR_FILE');
  return { name, content: readFileSync(path) };
});
for (const [name, value] of [
  ['submission.schema.json', contracts.submission],
  ['analysis.schema.json', contracts.analysis],
  ['rules.json', { version: contracts.version, instructions: contracts.rules }],
]) files.push({ name: `resources/${name}`, content: Buffer.from(JSON.stringify(value, null, 2)) });

const bodies = [], directory = [];
let offset = 0;
for (const { name, content } of files) {
  const filename = Buffer.from(name);
  const checksum = crc32(content);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); // UTF-8; Jan 1, 1980.
  header.writeUInt32LE(checksum, 14); header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22); header.writeUInt16LE(filename.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
  header.copy(entry, 8, 6, 28);
  entry.writeUInt32LE(offset, 42);
  bodies.push(header, filename, content); directory.push(entry, filename);
  offset += header.length + filename.length + content.length;
}
const central = Buffer.concat(directory), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...bodies, central, end]);
const name = 'ffp-seo-worker-1.0.0-preview.zip';
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, name), archive);
writeFileSync(join(destination, `${name}.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
console.log(`Agent Pack: dist/seo-agent-pack/${name}`);
