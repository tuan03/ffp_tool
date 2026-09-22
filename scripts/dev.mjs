import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

import { getLanIpv4Addresses } from "./dev-network.mjs";

function spawnNpmScript(scriptName) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], { stdio: "inherit" });
  }
  return spawn("npm", ["run", scriptName], { stdio: "inherit" });
}

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

const children = [
  spawnNpmScript("dev:web"),
  spawnNpmScript("dev:coordinator"),
  spawnNpmScript("dev:pipeline"),
];

let isStopping = false;

function stop(exitCode = 0) {
  if (isStopping) return;
  isStopping = true;
  for (const child of children) {
    if (child.killed || child.pid === undefined) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(exitCode), 500);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!isStopping) {
      console.error(`Development process exited (${signal ?? code ?? "unknown"}).`);
      stop(code ?? 1);
    }
  });
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
