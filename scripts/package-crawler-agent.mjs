import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const downloadsDir = path.join(root, "dist", "downloads");
await mkdir(downloadsDir, { recursive: true });

const tempPackageDir = await mkdtemp(path.join(os.tmpdir(), "ffp-crawler-agent-"));
const tarPath = path.join(downloadsDir, "ffp-crawler-agent.tar.gz");
const shaPath = path.join(downloadsDir, "ffp-crawler-agent.tar.gz.sha256");

try {
  execFileSync(process.execPath, [path.join(root, "scripts", "package-agent-source.mjs"), tempPackageDir], {
    cwd: root,
    stdio: "inherit",
  });

  execFileSync("tar", ["-czf", tarPath, "-C", tempPackageDir, "."], {
    cwd: root,
    stdio: "inherit",
  });

  const tarContent = await readFile(tarPath);
  const hash = createHash("sha256").update(tarContent).digest("hex");
  await writeFile(shaPath, `${hash}  ffp-crawler-agent.tar.gz\n`, "utf8");

  console.log(`Successfully packaged crawler agent to ${tarPath} (${hash})`);
} finally {
  await rm(tempPackageDir, { recursive: true, force: true });
}
