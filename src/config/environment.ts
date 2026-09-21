import type { AppEnvironment } from "../shared/types";

export type { AppEnvironment } from "../shared/types";

const supportedEnvironments: readonly AppEnvironment[] = ["mock", "development", "production"];

function isAppEnvironment(value: string): value is AppEnvironment {
  return supportedEnvironments.includes(value as AppEnvironment);
}

function getEnvironment(): AppEnvironment {
  const configuredEnvironment = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE;

  if (isAppEnvironment(configuredEnvironment)) {
    return configuredEnvironment;
  }

  return "development";
}

export const environment = getEnvironment();

function getAmazonCrawlerEngineUrl(): string {
  const configuredUrl = import.meta.env.VITE_AMAZON_CRAWLER_ENGINE_URL ?? "http://127.0.0.1:8765";
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("VITE_AMAZON_CRAWLER_ENGINE_URL must be a valid HTTP(S) URL.");
  }
}

export const amazonCrawlerEngineUrl = getAmazonCrawlerEngineUrl();
