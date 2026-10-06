import { spawn } from "node:child_process";
import process from "node:process";

const configs = [
  "tsconfig.json",
  "tsconfig.gateway.json",
  "tsconfig.pipeline.json",
];

const results = await Promise.all(
  configs.map((config) => {
    return new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        ["./node_modules/typescript/bin/tsc", "--noEmit", "-p", config],
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
