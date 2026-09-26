import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

test("concurrent benchmark completions persist independent samples and one complete report", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seo-benchmark-"));
  try {
    const codeRoot = path.join(directory, "code");
    const moduleDirectory = path.join(codeRoot, "src/modules/seo-content");
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(path.join(codeRoot, "package.json"), '{"type":"module"}');
    await writeFile(path.join(moduleDirectory, "index.ts"), `
      import { getDefaultResultOrder } from "node:dns";
      export const fromCustomizationProduct = product => product;
      export class FileSeoConflictCorpus { async upsertProduct() {} }
      export class SeoCorpusCommitCoordinator {
        async prepare(input) {
          const execution = await input.runSeo(); await input.register(execution);
          return { execution, revisionRetries: 0, timings: {} };
        }
      }
      export const createSeoContentSession = () => ({ async run() {
        if (getDefaultResultOrder() !== "ipv4first") throw new Error("Benchmark DNS differs from worker");
        await new Promise(resolve => setImmediate(resolve));
        return { output: { productTitle: "Fixture", productHandle: "fixture" },
          metadata: { fallbackStages: [], approvedKeywords: [] } };
      } });
    `);
    const inputs = path.join(directory, "inputs.json");
    const corpus = path.join(directory, "seed.json");
    const output = path.join(directory, "output");
    await writeFile(inputs, JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ productId: String(index) }))));
    await writeFile(corpus, '{"products":[]}');
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/benchmark-seo.mjs",
      `--code-root=${codeRoot}`, `--inputs=${inputs}`, `--corpus=${corpus}`, `--output=${output}`,
      "--store=fixture", "--workers=16", "--gemini=8",
    ], { env: { ...process.env, GOOGLE_CLOUD_PROJECT: "offline-test" } });
    const filenames = await readdir(output);
    assert.equal(filenames.filter(name => /^sample-\d+\.json$/.test(name)).length, 20);
    const samples = JSON.parse(await readFile(path.join(output, "samples.json"), "utf8"));
    assert.equal(new Set(samples.map(sample => sample.index)).size, 20);
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.successful, 20);
    assert.equal(report.errors, 0);
    assert.deepEqual(report.requests, { gemini: 0, embedding: 0, suggest: 0 });
    assert.equal(await readFile(corpus, "utf8"), '{"products":[]}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
