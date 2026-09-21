import { spawn } from "node:child_process";

function spawnNpmScript(scriptName) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], { stdio: "inherit" });
  }
  return spawn("npm", ["run", scriptName], { stdio: "inherit" });
}

const children = [spawnNpmScript("dev:web"), spawnNpmScript("dev:engine")];

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
