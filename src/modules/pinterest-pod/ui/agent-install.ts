export interface AgentInstallDetails {
  readonly serverUrl: string;
  readonly installerUrl: string;
  readonly powershellCommand: string;
  readonly batchFileContent: string;
  readonly isLoopback: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === "localhost"
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname === "0.0.0.0"
    || normalizedHostname === "::1"
    || normalizedHostname === "[::1]"
    || normalizedHostname.startsWith("127.");
}

export function buildAgentInstallDetails(serverUrlInput: string): AgentInstallDetails {
  const trimmedServerUrl = serverUrlInput.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedServerUrl);
  } catch {
    throw new Error("Server URL must be an absolute HTTP(S) URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Server URL must use HTTP or HTTPS.");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Server URL must not contain credentials.");
  }
  if (parsedUrl.search) {
    throw new Error("Server URL must not contain query parameters.");
  }
  if (parsedUrl.hash) {
    throw new Error("Server URL must not contain a fragment.");
  }
  if (parsedUrl.pathname !== "/") {
    throw new Error("Server URL must be an origin without a path.");
  }

  const serverUrl = parsedUrl.origin;
  const installerUrl = `${serverUrl}/install-agent.ps1`;
  const powershellCommand = `$env:FFP_SERVER_URL="${serverUrl}"; irm "$env:FFP_SERVER_URL/install-agent.ps1" | iex`;
  const batchFileContent = [
    "@echo off",
    "setlocal",
    "title Cai Dat FFP Crawler Agent",
    `set "FFP_SERVER_URL=${serverUrl}"`,
    "echo Dang cai FFP Crawler Agent tu %FFP_SERVER_URL%...",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm ($env:FFP_SERVER_URL + '/install-agent.ps1') | iex\"",
    "if errorlevel 1 echo Cai dat that bai. Vui long kiem tra ket noi va thu lai.",
    "pause",
    "",
  ].join("\r\n");

  return {
    serverUrl,
    installerUrl,
    powershellCommand,
    batchFileContent,
    isLoopback: isLoopbackHostname(parsedUrl.hostname),
  };
}
