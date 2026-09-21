import { ProxyAgent } from "undici";
import { GatewayError, sanitizeErrorMessage } from "./errors";
import type { HttpTransport, StoreConfig } from "./types";

export interface ProxyTransportFactory {
  createTransport(store: StoreConfig, baseTransport?: HttpTransport): HttpTransport;
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

  let proxyUrl = proxy.url;
  if (proxy.username && proxy.password) {
    try {
      const parsed = new URL(proxyUrl);
      parsed.username = proxy.username;
      parsed.password = proxy.password;
      proxyUrl = parsed.toString();
    } catch {
      // ignore parsing error
    }
  }

  const agent = new ProxyAgent(proxyUrl);

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
