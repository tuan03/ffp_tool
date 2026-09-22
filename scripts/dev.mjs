import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

import { getLanIpv4Addresses } from "./dev-network.mjs";

function spawnNpmScript(scriptName) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], { stdio: "inherit" });
  }
  return spawn("npm", ["run", scriptName], { stdio: "inherit" });
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

const children = [spawnNpmScript("dev:web"), spawnNpmScript("dev:coordinator")];

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
