import type { PropsWithChildren } from "react";

import { ThemeProvider } from "./ThemeProvider";

/**
 * Register application-wide providers here as the application grows.
 * Theme is shared across routes; register future auth/query providers here too.
 */
export function AppProviders({ children }: PropsWithChildren): React.JSX.Element {
  return <ThemeProvider>{children}</ThemeProvider>;
}
