import { ProxyAgent } from "undici";
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
        ? (globalThis.fetch(url, requestInit) as Promise<Response>)
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
