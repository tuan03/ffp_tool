/**
 * FFP Ads Intelligence — Local AI Runner Service
 * Automatically detects installed AI CLI tools (Codex CLI, Antigravity CLI) on the user's machine,
 * supports model selection, and executes analysis via local agent rather than cloud Gemini.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AiStrategicReport } from "./types";

export interface LocalAiRunnerInfo {
  readonly id: "codex" | "agy";
  readonly name: string;
  readonly available: boolean;
  readonly executablePath?: string;
  readonly version?: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
}

export interface LocalAiDetectionResult {
  readonly platform: string;
  readonly runners: readonly LocalAiRunnerInfo[];
}

export interface LocalAiExecutionOptions {
  readonly runner?: "codex" | "agy";
  readonly model?: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

const KNOWN_CODEX_MODELS = [
  "gpt-5.6-terra",
  "gpt-4o",
  "o3-mini",
  "o1",
] as const;

const KNOWN_AGY_MODELS = [
  "claude-sonnet-5-5-medium",
  "claude-opus-5-5-medium",
  "gemini-3.8-flash-high",
  "gemini-3.1-pro-high",
  "gpt-oss-120b-medium",
] as const;

function findWindowsPath(executableName: string): string | null {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates: string[] = [];

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

export class LocalAiRunnerService {
  private readonly bridgeUrl = process.env.LOCAL_AGENT_BRIDGE_URL || "http://host.docker.internal:3015";

  /**
   * Detects available AI CLI runners on the local machine
   */
  async detectRunners(): Promise<LocalAiDetectionResult> {
    // If running in Docker (Linux), try bridge first
    if (process.platform !== "win32") {
      try {
        const res = await fetch(`${this.bridgeUrl}/detect`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = (await res.json()) as LocalAiDetectionResult;
          return data;
        }
      } catch {
        // Bridge not reachable, return standard catalog with bridge status
      }
    }

    // Direct Windows host detection
    const codexPath = findWindowsPath("codex");
    const agyPath = findWindowsPath("agy");

    const runners: LocalAiRunnerInfo[] = [
      {
        id: "codex",
        name: "OpenAI Codex CLI",
        available: Boolean(codexPath),
        executablePath: codexPath || undefined,
        version: codexPath ? "0.154.0" : undefined,
        defaultModel: "gpt-5.6-terra",
        models: KNOWN_CODEX_MODELS,
      },
      {
        id: "agy",
        name: "Antigravity CLI (AGY)",
        available: Boolean(agyPath),
        executablePath: agyPath || undefined,
        version: agyPath ? "1.2.16" : undefined,
        defaultModel: "claude-sonnet-5-5-medium",
        models: KNOWN_AGY_MODELS,
      },
    ];

    return {
      platform: process.platform,
      runners,
    };
  }

  /**
   * Executes AI analysis using local CLI (Codex or AGY)
   */
  async runAnalysis(options: LocalAiExecutionOptions): Promise<string | null> {
    const runnerId = options.runner || "codex";
    const model = options.model || (runnerId === "codex" ? "gpt-5.6-terra" : "claude-sonnet-5-5-medium");
    const timeoutMs = options.timeoutMs || 45000;

    // Mode A: If in Docker, call Host Bridge
    if (process.platform !== "win32") {
      try {
        const res = await fetch(`${this.bridgeUrl}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runner: runnerId, model, prompt: options.prompt }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const json = (await res.json()) as { success: boolean; output: string };
          if (json.success && json.output) {
            return json.output;
          }
        }
      } catch (err) {
        console.warn("[LocalAiRunnerService] Host bridge call failed:", err);
      }
    }

    // Mode B: Direct execution on Windows host
    const exePath = findWindowsPath(runnerId);
    if (!exePath) {
      console.warn(`[LocalAiRunnerService] ${runnerId} not found on host machine`);
      return null;
    }

    return new Promise<string | null>((resolve) => {
      let args: string[] = [];
      if (runnerId === "codex") {
        args = ["exec", "-m", model, "--skip-git-repo-check", options.prompt];
      } else {
        args = ["--dangerously-skip-permissions", "--model", model, "--print", options.prompt];
      }

      const proc = spawn(exePath, args, {
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

      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        console.warn(`[LocalAiRunnerService] ${runnerId} timed out after ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        let finalOutput = stdout.trim();
        if (runnerId === "agy" && finalOutput.startsWith("{")) {
          try {
            const agyJson = JSON.parse(finalOutput);
            if (agyJson.response && typeof agyJson.response === "string") {
              finalOutput = agyJson.response.trim();
            }
          } catch {
            // ignore
          }
        }

        if (code === 0 && finalOutput) {
          resolve(finalOutput);
        } else {
          console.warn(`[LocalAiRunnerService] ${runnerId} exited with code ${code}. Stderr: ${stderr}`);
          // If stdout has valid json despite non-zero exit, still try
          if (finalOutput.includes("{") && finalOutput.includes("}")) {
            resolve(finalOutput);
          } else {
            resolve(null);
          }
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        console.warn(`[LocalAiRunnerService] Failed to spawn ${runnerId}:`, err);
        resolve(null);
      });
    });
  }
}

export const localAiRunner = new LocalAiRunnerService();
