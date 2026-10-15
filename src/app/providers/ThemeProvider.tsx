import { createContext, useContext, useEffect, useState } from "react";
import type { PropsWithChildren } from "react";

import { readThemePreference, saveThemePreference, THEME_STORAGE_KEY } from "../theme/theme-preference";
import type { AppTheme } from "../theme/theme-preference";

interface ThemeContextValue {
  readonly theme: AppTheme;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [theme, setTheme] = useState<AppTheme>(() => {
    try { return typeof window === "undefined" ? "light" : readThemePreference(window.localStorage); }
    catch { return "light"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try { saveThemePreference(theme, window.localStorage); }
    catch { /* Accessing the storage object itself can be blocked. */ }
  }, [theme]);

  useEffect(() => {
    function handleStorageChange(event: StorageEvent): void {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      try { setTheme(readThemePreference(window.localStorage)); }
      catch { setTheme("light"); }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(current => current === "light" ? "dark" : "light") }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Theme controls require the application ThemeProvider.");
  return context;
}
