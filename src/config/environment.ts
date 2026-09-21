import type { AppEnvironment } from "../shared/types";

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
