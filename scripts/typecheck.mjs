import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const cacheDir = path.resolve(".cache", "tsbuildinfo");
await mkdir(cacheDir, { recursive: true });

const configs = [
  { config: "tsconfig.json", name: "root" },
  { config: "tsconfig.gateway.json", name: "gateway" },
  { config: "tsconfig.pipeline.json", name: "pipeline" },
];

const results = await Promise.all(
  configs.map(({ config, name }) => {
    return new Promise((resolve) => {
      const tsBuildInfoPath = path.join(cacheDir, `${name}.tsbuildinfo`);
      const proc = spawn(
        process.execPath,
        [
          "./node_modules/typescript/bin/tsc",
          "--noEmit",
          "--incremental",
          "--tsBuildInfoFile",
          tsBuildInfoPath,
          "-p",
          config,
        ],
        { stdio: "inherit" }
      );
      proc.on("close", (code) => {
        resolve({ config, code: code ?? 1 });
      });
      proc.on("error", (err) => {
        console.error(`Error running tsc for ${config}:`, err);
        resolve({ config, code: 1 });
      });
    });
  })
);

const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  console.error(`Typecheck failed for: ${failed.map((f) => f.config).join(", ")}`);
  process.exit(1);
}
