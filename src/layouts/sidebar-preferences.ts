const SIDEBAR_STORAGE_KEY = "ffp_sidebar_collapsed";

export function readSidebarCollapsed(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(storage: Pick<Storage, "setItem">, isCollapsed: boolean): void {
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed));
  } catch {
    // The menu remains usable when browser storage is disabled.
  }
}
