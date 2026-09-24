import { fetch as undiciFetch, ProxyAgent } from "undici";
import { GatewayError, sanitizeErrorMessage } from "./errors";
import type { HttpTransport, StoreConfig } from "./types";

export interface ProxyTransportFactory {
  createTransport(store: StoreConfig, baseTransport?: HttpTransport): HttpTransport;
}

/**
 * Global pool caching ProxyAgent instances by normalized proxy URL
 * to reuse underlying HTTP/TLS connections across requests.
 */
export const proxyAgentPool = new Map<string, ProxyAgent>();

export function clearProxyAgentPool(): void {
  for (const agent of proxyAgentPool.values()) {
    void agent.close().catch(() => {});
  }
  proxyAgentPool.clear();
}

function getOrCreateProxyAgent(normalizedUrl: string): ProxyAgent {
  let agent = proxyAgentPool.get(normalizedUrl);
  if (!agent) {
    agent = new ProxyAgent(normalizedUrl);
    proxyAgentPool.set(normalizedUrl, agent);
  }
  return agent;
}

export function createStoreTransport(
  store: StoreConfig,
  baseTransport: HttpTransport = globalThis.fetch,
  proxyTransport: HttpTransport = undiciFetch as unknown as HttpTransport,
): HttpTransport {
  const proxy = store.proxy;
  if (!proxy || !proxy.url) {
    return baseTransport;
  }

  const failClosed = proxy.failClosed !== false;

  let parsed: URL;
  try {
    parsed = new URL(proxy.url);
  } catch (err: unknown) {
    const sanitizedUrl = sanitizeErrorMessage(proxy.url, "invalid-proxy-url");
    throw new GatewayError(
      `Invalid proxy URL '${sanitizedUrl}': invalid URL format`,
      "SHOPIFY_NETWORK_ERROR",
      502,
      undefined,
      err,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new GatewayError(
      `Invalid proxy URL protocol '${parsed.protocol}': only 'http:' and 'https:' are supported`,
      "SHOPIFY_NETWORK_ERROR",
      502,
    );
  }

  if (proxy.username) {
    parsed.username = proxy.username;
  }
  if (proxy.password) {
    parsed.password = proxy.password;
  }

  const normalizedProxyUrl = parsed.toString();
  const agent = getOrCreateProxyAgent(normalizedProxyUrl);

  return async (url: string, init?: RequestInit): Promise<Response> => {
    try {
      const requestInit = {
        ...init,
        dispatcher: agent,
      };

      return await (baseTransport === globalThis.fetch
        ? proxyTransport(url, requestInit)
        : baseTransport(url, requestInit));
    } catch (proxyError: unknown) {
      if (
        (proxyError instanceof Error &&
          (proxyError.name === "AbortError" || proxyError.name === "TimeoutError")) ||
        init?.signal?.aborted
      ) {
        throw proxyError;
      }
      if (failClosed) {
        const sanitizedErr = sanitizeErrorMessage(
          proxyError instanceof Error ? proxyError.message : String(proxyError),
          "Proxy connection failed",
        );
        throw new GatewayError(
          `Proxy transport failed: ${sanitizedErr}; connection closed per fail-closed policy`,
          "SHOPIFY_NETWORK_ERROR",
          502,
          undefined,
          proxyError,
        );
      }
      return baseTransport(url, init);
    }
  };
}

export interface ProxyCheckResult {
  readonly success: boolean;
  readonly ip?: string;
  readonly country?: string;
  readonly latencyMs?: number;
  readonly error?: string;
}

/**
 * Tests an HTTP/HTTPS proxy by querying Cloudflare trace endpoint.
 * Returns public IP, country code, and latency in milliseconds.
 */
export async function checkProxyConnection(
  proxy: { url: string; username?: string; password?: string },
  timeoutMs = 8000,
): Promise<ProxyCheckResult> {
  const trimmedUrl = String(proxy.url || "").trim();
  if (!trimmedUrl) {
    return {
      success: false,
      error: "Vui lòng nhập Proxy URL.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return {
      success: false,
      error: `Định dạng Proxy URL không hợp lệ: '${trimmedUrl}'`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      success: false,
      error: `Giao thức '${parsed.protocol}' không được hỗ trợ. Chỉ hỗ trợ 'http:' hoặc 'https:'`,
    };
  }

  if (proxy.username) {
    parsed.username = proxy.username;
  }
  if (proxy.password) {
    parsed.password = proxy.password;
  }

  const normalizedProxyUrl = parsed.toString();
  const agent = getOrCreateProxyAgent(normalizedProxyUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();
  try {
    const res = await undiciFetch("https://cloudflare.com/cdn-cgi/trace", {
      dispatcher: agent,
      signal: controller.signal,
    });

    const latencyMs = Math.round(Date.now() - startTime);

    if (res.status === 407) {
      return {
        success: false,
        latencyMs,
        error: "Lỗi HTTP 407: Sai Username hoặc Password của Proxy",
      };
    }

    if (!res.ok) {
      return {
        success: false,
        latencyMs,
        error: `Proxy phản hồi HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const text = await res.text();
    let ip = "";
    let country = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("ip=")) {
        ip = line.slice(3).trim();
      } else if (line.startsWith("loc=")) {
        country = line.slice(4).trim();
      }
    }

    return {
      success: true,
      ip: ip || "Unknown",
      country: country || undefined,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(Date.now() - startTime);
    if (err instanceof Error) {
      if (err.name === "AbortError" || err.message.toLowerCase().includes("aborted")) {
        return {
          success: false,
          latencyMs,
          error: `Proxy timeout sau ${timeoutMs / 1000}s (Không thể kết nối hoặc proxy quá chậm)`,
        };
      }
      return {
        success: false,
        latencyMs,
        error: `Không thể kết nối tới proxy: ${err.message}`,
      };
    }
    return {
      success: false,
      latencyMs,
      error: "Không thể kết nối tới proxy.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
