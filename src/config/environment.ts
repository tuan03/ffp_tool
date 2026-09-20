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
