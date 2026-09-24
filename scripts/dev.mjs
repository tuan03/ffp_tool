import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

import { getLanIpv4Addresses } from "./dev-network.mjs";
import { getDevelopmentProcessSpecs } from "./dev-processes.mjs";

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      reject(new Error(`Port ${port} is already in use. Stop the previous FFP dev process before running npm run dev again.`, { cause: error }));
    });
    server.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
      server.close(resolve);
    });
  });
}

try {
  await Promise.all([5173, 8766, 3001].map(assertPortAvailable));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const lanAddresses = getLanIpv4Addresses(networkInterfaces());
console.log("Development services are available at:");
console.log("  Local UI:          http://127.0.0.1:5173/");
console.log("  Local coordinator: http://127.0.0.1:8766/api/v1/health");
for (const address of lanAddresses) {
  console.log(`  LAN UI:            http://${address}:5173/`);
  console.log(`  LAN coordinator:   http://${address}:8766/api/v1/health`);
  console.log(`  Client serverUrl:  http://${address}:8766`);
}
if (lanAddresses.length === 0) {
  console.log("  No external IPv4 address was detected. Check the active network adapter.");
}

const children = getDevelopmentProcessSpecs().map((spec) => ({
  spec,
  childProcess: spawn(spec.command, spec.args, {
    stdio: "inherit",
    windowsHide: true,
  }),
}));

let isStopping = false;

function stopChildProcess(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null || childProcess.pid === undefined) {
    return Promise.resolve();
  }
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(childProcess.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  }
  childProcess.kill("SIGTERM");
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill("SIGKILL");
      }
      resolve();
    }, 2_000);
    timeout.unref();
    childProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stop(exitCode = 0) {
  if (isStopping) return;
  isStopping = true;
  await Promise.all(children.map(({ childProcess }) => stopChildProcess(childProcess)));
  process.exit(exitCode);
}

for (const { spec, childProcess } of children) {
  childProcess.on("exit", (code, signal) => {
    if (!isStopping) {
      console.error(`[dev] ${spec.name} exited unexpectedly (${signal ?? code ?? "unknown"}).`);
      void stop(code && code > 0 ? code : 1);
    }
  });
  childProcess.on("error", (error) => {
    console.error(`[dev] Unable to start ${spec.name}: ${error.message}`);
    void stop(1);
  });
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
