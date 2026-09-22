import type { AppEnvironment } from "../shared/types";

import { resolveAmazonCoordinatorUrl } from "./amazon-crawler-url";

export type { AppEnvironment } from "../shared/types";

const supportedEnvironments: readonly AppEnvironment[] = ["mock", "development", "production"];

function isAppEnvironment(value: string): value is AppEnvironment {
  return supportedEnvironments.includes(value as AppEnvironment);
}

function getEnvironment(): AppEnvironment {
  const configuredEnvironment =
    import.meta.env?.VITE_APP_ENV ??
    import.meta.env?.MODE ??
    process.env.VITE_APP_ENV ??
    process.env.NODE_ENV;

  if (typeof configuredEnvironment === "string" && isAppEnvironment(configuredEnvironment)) {
    return configuredEnvironment;
  }

  return "development";
}

export const environment = getEnvironment();

function getAmazonCrawlerCoordinatorUrl(): string {
  const configuredUrl = import.meta.env.VITE_AMAZON_COORDINATOR_URL ?? import.meta.env.VITE_AMAZON_CRAWLER_ENGINE_URL;
  const browserLocation = typeof window === "undefined" ? null : window.location;
  return resolveAmazonCoordinatorUrl({
    configuredUrl,
    browserHostname: browserLocation?.hostname || "127.0.0.1",
    browserProtocol: browserLocation?.protocol || "http:",
  });
}

export const amazonCrawlerCoordinatorUrl = getAmazonCrawlerCoordinatorUrl();
