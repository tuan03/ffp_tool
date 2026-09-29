export type AgentVersionStatus = "current" | "outdated" | "ahead" | "unknown";

function parseStableVersion(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;

  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function getAgentVersionStatus(installedVersion: string, latestVersion: string): AgentVersionStatus {
  const installed = parseStableVersion(installedVersion);
  const latest = parseStableVersion(latestVersion);
  if (!installed || !latest) return "unknown";

  for (let index = 0; index < installed.length; index += 1) {
    const installedPart = installed[index] ?? 0;
    const latestPart = latest[index] ?? 0;
    if (installedPart < latestPart) return "outdated";
    if (installedPart > latestPart) return "ahead";
  }
  return "current";
}
