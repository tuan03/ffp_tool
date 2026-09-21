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
  if (!proxy) {
    return baseTransport;
  }

  const failClosed = proxy.failClosed !== false;

  return async (url: string, init?: RequestInit): Promise<Response> => {
    try {
      const headers = new Headers(init?.headers);
      if (proxy.username && proxy.password) {
        const credentials = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
        headers.set("Proxy-Authorization", `Basic ${credentials}`);
      }
      headers.set("X-Forwarded-Through-Proxy", proxy.url);

      return await baseTransport(url, {
        ...init,
        headers,
      });
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
