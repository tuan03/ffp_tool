import type { PropsWithChildren } from "react";

/**
 * Register application-wide providers here as the application grows.
 * Examples: query client, authentication, theme, and i18n providers.
 */
export function AppProviders({ children }: PropsWithChildren): React.JSX.Element {
  return <>{children}</>;
}
