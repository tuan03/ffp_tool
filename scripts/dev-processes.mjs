import fs from "node:fs";
import path from "node:path";

function getDefaultPythonExecutable() {
  if (process.env.PYTHON?.trim()) {
    return process.env.PYTHON.trim();
  }
  const venvPython = process.platform === "win32"
    ? path.resolve(process.cwd(), ".venv/Scripts/python.exe")
    : path.resolve(process.cwd(), ".venv/bin/python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return "python";
}

export function getWebHost() {
  if (process.env.VITE_HOST?.trim()) {
    return process.env.VITE_HOST.trim();
  }
  if (process.env.GATEWAY_AUTH_TOKEN?.trim()) {
    return "0.0.0.0";
  }
  const envLocalPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envLocalPath)) {
    try {
      const content = fs.readFileSync(envLocalPath, "utf8");
      const match = content.match(/^\s*GATEWAY_AUTH_TOKEN\s*=\s*['"]?([^'"\r\n]+)['"]?/m);
      if (match && match[1]?.trim()) {
        return "0.0.0.0";
      }
    } catch {
      // Ignore filesystem errors and default to local
    }
  }
  return "127.0.0.1";
}

export function getDevelopmentProcessSpecs({
  nodeExecutable = process.execPath,
  pythonExecutable = getDefaultPythonExecutable(),
} = {}) {
  const webHost = getWebHost();
  return [
    {
      name: "web",
      command: nodeExecutable,
      args: [
        "--disable-warning=ExperimentalWarning",
        "./node_modules/vite/bin/vite.js",
        "--configLoader",
        "runner",
        "--host",
        webHost,
      ],
    },
    {
      name: "coordinator",
      command: pythonExecutable,
      args: [
        "-m",
        "uvicorn",
        "engine.distributed.coordinator_server:app",
        "--app-dir",
        "src/modules/amazon-crawler",
        "--host",
        "0.0.0.0",
        "--port",
        "8766",
        "--reload",
      ],
    },
    {
      name: "pipeline",
      command: nodeExecutable,
      args: [
        "--disable-warning=ExperimentalWarning",
        "--import",
        "tsx",
        "scripts/shopify-pipeline-worker.ts",
      ],
    },
  ];
}
