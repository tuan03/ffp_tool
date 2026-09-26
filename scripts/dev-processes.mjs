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

export function getDevelopmentProcessSpecs({
  nodeExecutable = process.execPath,
  pythonExecutable = getDefaultPythonExecutable(),
} = {}) {
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
        "0.0.0.0",
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
