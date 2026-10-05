import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

test("AGY starts in the job directory with its helper ready and no competing workspace", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-runner-test-"));
  const previousPath = process.env.PATH;
  const previousSkill = process.env.ADS_SPY_SKILL_DIR;
  try {
    const directory = join(root, "job");
    await mkdir(directory);
    await mkdir(join(root, "references"));
    for (const file of ["SKILL.md", "references/qualification.md", "references/ad-collection.md", "references/dashboard-publishing.md"]) await writeFile(join(root, file), "Test skill fixture");
    const executable = join(root, "agy");
    await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync('capture.json',JSON.stringify({cwd:process.cwd(),helper:fs.existsSync('ffp-tools.mjs'),args:process.argv.slice(2)}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'fixture'}}));`);
    await chmod(executable, 0o700);
    process.env.PATH = root + delimiter + (previousPath ?? "");
    process.env.ADS_SPY_SKILL_DIR = root;
    const { executeSpy } = await import("../ads-intelligence/spy-runner");
    await executeSpy({ directory, signal: new AbortController().signal, job: { id: "test", storeId: "one", shopDomain: "one.myshopify.com", runner: "agy", model: "test-model", status: "running", startedAt: "2026-01-01T00:00:00Z", phase: "profile" } });
    const capture = JSON.parse(await readFile(join(directory, "capture.json"), "utf8")) as { cwd: string; helper: boolean; args: string[] };
    assert.equal(capture.cwd, await realpath(directory));
    assert.equal(capture.helper, true);
    assert.equal(capture.args.includes("--add-dir"), false);
    assert.equal(capture.args.includes("--dangerously-skip-permissions"), false);
    assert.ok(capture.args.at(-1)?.includes("automatically writes each response to a JSON file"));
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousSkill === undefined) delete process.env.ADS_SPY_SKILL_DIR; else process.env.ADS_SPY_SKILL_DIR = previousSkill;
    await rm(root, { recursive: true, force: true });
  }
});
