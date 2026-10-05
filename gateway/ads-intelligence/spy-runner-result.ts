/** Classify CLI failures without retaining prompts, tool output, or credentials. */
export function classifySpyRunnerResult(input: { runner: "codex" | "agy"; exitCode: number | null; stdout: string; stderr: string }): string | undefined {
  if (/headless mode cannot prompt|auto-denied|permission.*denied/i.test(input.stderr)) return "SPY_PERMISSION_REQUIRED";
  if (input.exitCode !== 0 && /login|authentication|unauthorized/i.test(input.stderr)) return "SPY_LOGIN_REQUIRED";
  if (input.runner === "agy") {
    let response: unknown;
    try { response = JSON.parse(input.stdout); } catch { return "SPY_RUNNER_RESPONSE_INVALID"; }
    if (!response || typeof response !== "object") return "SPY_RUNNER_RESPONSE_INVALID";
    if ("denied_actions" in response && Array.isArray(response.denied_actions) && response.denied_actions.length) return "SPY_PERMISSION_REQUIRED";
    if (!("status" in response) || response.status !== "SUCCESS") return "SPY_RUNNER_FAILED";
  }
  if (input.exitCode !== 0) return "SPY_RUNNER_FAILED";
  return undefined;
}
