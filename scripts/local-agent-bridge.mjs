/**
 * FFP Ads Intelligence — Windows Host Agent Bridge
 * Lightweight HTTP server running on port 3015 to allow Docker containers
 * (or local frontend) to trigger native Windows Codex CLI and AGY CLI.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3015;

function findWindowsPath(executableName) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [];

  if (executableName === "codex") {
    candidates.push(
      path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe")
    );
  } else if (executableName === "agy") {
    candidates.push(
      path.join(localAppData, "agy", "bin", "agy.exe"),
      path.join(os.homedir(), "AppData", "Local", "agy", "bin", "agy.exe")
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/detect") {
    const codexPath = findWindowsPath("codex");
    const agyPath = findWindowsPath("agy");

    const response = {
      platform: process.platform,
      runners: [
        {
          id: "codex",
          name: "OpenAI Codex CLI",
          available: Boolean(codexPath),
          executablePath: codexPath || undefined,
          version: "0.154.0",
          defaultModel: "gpt-5.6-terra",
          models: ["gpt-5.6-terra", "gpt-4o", "o3-mini", "o1"],
        },
        {
          id: "agy",
          name: "Antigravity CLI (AGY)",
          available: Boolean(agyPath),
          executablePath: agyPath || undefined,
          version: "1.2.16",
          defaultModel: "claude-sonnet-5-5-medium",
          models: [
            "claude-sonnet-5-5-medium",
            "claude-opus-5-5-medium",
            "gemini-3.8-flash-high",
            "gemini-3.1-pro-high",
            "gpt-oss-120b-medium",
          ],
        },
      ],
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const runner = payload.runner || "codex";
        const model = payload.model || (runner === "codex" ? "gpt-5.6-terra" : "claude-sonnet-5-5-medium");
        const prompt = payload.prompt;

        if (!prompt) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing prompt" }));
          return;
        }

        const exePath = findWindowsPath(runner);
        if (!exePath) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `${runner} not found on Windows host` }));
          return;
        }

        let args = [];
        if (runner === "codex") {
          args = ["exec", "-m", model, "--skip-git-repo-check", prompt];
        } else {
          args = ["--dangerously-skip-permissions", "--model", model, "--print", prompt];
        }

        console.log(`[Bridge] Executing ${runner} with model ${model}...`);
        const proc = spawn(exePath, args, {
          cwd: "D:\\CODE\\Code_Clone\\ffp_tool",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });

        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });

        proc.on("close", (code) => {
          console.log(`[Bridge] ${runner} finished with code ${code}`);
          let finalOutput = stdout.trim();
          if (runner === "agy" && finalOutput.startsWith("{")) {
            try {
              const agyJson = JSON.parse(finalOutput);
              if (agyJson.response && typeof agyJson.response === "string") {
                finalOutput = agyJson.response.trim();
              }
            } catch {
              // ignore
            }
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: code === 0 || finalOutput.includes("{"),
              runner,
              model,
              exitCode: code,
              output: finalOutput,
              error: stderr.trim() || undefined,
            })
          );
        });

        proc.on("error", (err) => {
          console.error(`[Bridge] Error spawning ${runner}:`, err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[HostAgentBridge] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[HostAgentBridge] Ready to forward AI analysis requests to Windows Codex/AGY CLI`);
});
