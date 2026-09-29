import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.resolve(process.argv[2] ?? "");

if (!process.argv[2]) {
  throw new Error("Usage: node scripts/package-agent-source.mjs <empty-output-directory>");
}

const blockedNames = new Set([
  ".env",
  ".pinterest_browser_profile",
  ".pinterest_oauth_tokens.json",
  ".runtime",
  "__pycache__",
  "data",
  "output",
  "temp",
  "tests",
]);

const sourceEntries = [
  "config/amazon-crawler-agent.example.json",
  "dang-nhap-pinterest.bat",
  "scripts/amazon-crawler-agent.py",
  "scripts/install-agent.ps1",
  "scripts/login-pinterest.sh",
  "scripts/uninstall-agent.ps1",
  "scripts/update-agent.ps1",
  "src/modules/amazon-crawler/engine",
  "src/modules/pinterest-pod/server/desktop_notifier.py",
  "src/modules/pinterest-pod/server/job_repository.py",
  "src/modules/pinterest-pod/server/pinterest",
  "src/modules/pinterest-pod/server/pinterest_pod_bridge.py",
  "src/modules/pinterest-pod/server/trend_tool",
];

async function outputDirectoryIsEmpty() {
  try {
    return (await readdir(outputRoot)).length === 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

if (!(await outputDirectoryIsEmpty())) {
  throw new Error(`Agent package output directory must be empty: ${outputRoot}`);
}

await mkdir(outputRoot, { recursive: true });

function shouldCopy(source) {
  const relativePath = path.relative(repositoryRoot, source);
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => blockedNames.has(part))) {
    return false;
  }
  return !source.endsWith(".pyc");
}

for (const relativePath of sourceEntries) {
  const source = path.join(repositoryRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  await cp(source, destination, {
    recursive: true,
    filter: shouldCopy,
  });
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

const packagedFiles = await collectFiles(outputRoot);
const manifestFiles = [];
for (const filename of packagedFiles.sort()) {
  const contents = await readFile(filename);
  const metadata = await stat(filename);
  manifestFiles.push({
    path: path.relative(outputRoot, filename).split(path.sep).join("/"),
    bytes: metadata.size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

await writeFile(
  path.join(outputRoot, "agent-package-manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, files: manifestFiles }, null, 2)}\n`,
  "utf8",
);

console.log(`Packaged ${manifestFiles.length} crawler-agent source files in ${outputRoot}`);
