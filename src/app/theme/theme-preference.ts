export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ffp_theme";

export function readThemePreference(storage?: Pick<Storage, "getItem">): AppTheme {
  try { return storage?.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function saveThemePreference(theme: AppTheme, storage?: Pick<Storage, "setItem">): void {
  try { storage?.setItem(THEME_STORAGE_KEY, theme); }
  catch { /* Theme remains usable for this tab when storage is unavailable. */ }
}
