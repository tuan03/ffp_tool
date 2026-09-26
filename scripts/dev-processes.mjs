export function getDevelopmentProcessSpecs({
  nodeExecutable = process.execPath,
  pythonExecutable = process.env.PYTHON?.trim() || "python",
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
