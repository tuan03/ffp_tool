const DEFAULT_PUBLIC_AGENT_INSTALL_URL = "https://ffp.b6-team.site";

interface ResolveAgentInstallServerUrlInput {
  readonly configuredUrl?: string;
  readonly browserOrigin?: string;
}

function normalizeServerOrigin(value: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new Error("Agent install URL must be an absolute HTTP(S) URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Agent install URL must use HTTP or HTTPS.");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Agent install URL must not contain credentials.");
  }
  if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
    throw new Error("Agent install URL must be an origin without a path, query, or fragment.");
  }

  return parsedUrl.origin;
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "[::1]"
    || hostname.startsWith("127.");
}

export function resolveAgentInstallServerUrl({
  configuredUrl,
  browserOrigin,
}: ResolveAgentInstallServerUrlInput): string {
  if (configuredUrl?.trim()) return normalizeServerOrigin(configuredUrl);

  if (browserOrigin?.trim()) {
    const normalizedBrowserOrigin = normalizeServerOrigin(browserOrigin);
    if (!isLoopbackOrigin(normalizedBrowserOrigin)) return normalizedBrowserOrigin;
  }

  return DEFAULT_PUBLIC_AGENT_INSTALL_URL;
}

const browserOrigin = typeof window === "undefined" ? undefined : window.location.origin;

export const agentInstallServerUrl = resolveAgentInstallServerUrl({
  configuredUrl: import.meta.env?.VITE_AGENT_INSTALL_URL,
  browserOrigin,
});
