import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { environment } from "../config/environment";
import {
  ACTIVE_STORE_CHANGED_EVENT,
  normalizeActiveStoreId,
  persistActiveStoreId,
  readActiveStoreId,
} from "../shared/active-store";

import { AppSidebar, NAVIGATION_GROUPS } from "./components/AppSidebar";
import { NotificationPermissionBadge } from "./components/NotificationPermissionBadge";
import { NotificationToastContainer } from "./components/NotificationToastContainer";
import { readSidebarCollapsed, saveSidebarCollapsed } from "./sidebar-preferences";

export function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const queryStoreId = useMemo(
    () => normalizeActiveStoreId(new URLSearchParams(location.search).get("storeId")),
    [location.search],
  );
  const [activeStoreId, setActiveStoreId] = useState(() => {
    if (queryStoreId) return queryStoreId;
    try {
      return typeof window === "undefined" ? "" : readActiveStoreId(window.localStorage);
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!queryStoreId) return;
    setActiveStoreId(queryStoreId);
    try {
      persistActiveStoreId(queryStoreId, window.localStorage);
    } catch {
      // Navigation still carries the selected store when storage is unavailable.
    }
  }, [queryStoreId]);

  useEffect(() => {
    function handleStoreChange(event: Event): void {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
      setActiveStoreId(normalizeActiveStoreId(event.detail));
    }
    window.addEventListener(ACTIVE_STORE_CHANGED_EVENT, handleStoreChange);
    return () => window.removeEventListener(ACTIVE_STORE_CHANGED_EVENT, handleStoreChange);
  }, []);


  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return typeof window !== "undefined" && readSidebarCollapsed(window.localStorage);
    } catch {
      return false;
    }
  });
  const activeDestination = NAVIGATION_GROUPS.flatMap(group => group.destinations)
    .find(destination => location.pathname === destination.path || location.pathname.startsWith(destination.path + "/"));
  const pageTitle = location.pathname === "/amazon-crawler/agent-keys" ? "Agent Keys" : activeDestination?.label ?? "FFP Tool";

  useEffect(() => {
    document.title = `${pageTitle} · FFP Tool`;
  }, [pageTitle]);

  function handleToggleSidebar(): void {
    const nextCollapsed = !isSidebarCollapsed;
    setIsSidebarCollapsed(nextCollapsed);
    try {
      saveSidebarCollapsed(window.localStorage, nextCollapsed);
    } catch {
      // Keep navigation available even when access to storage itself is blocked.
    }
  }

  return (
    <div className="flex min-h-dvh items-start bg-white text-slate-900">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-blue-600 px-4 py-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Đi tới nội dung</a>
      <AppSidebar activeStoreId={activeStoreId} isCollapsed={isSidebarCollapsed} onToggle={handleToggleSidebar} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="text-slate-500">Không gian làm việc</span>
            <span aria-hidden="true" className="text-slate-300">/</span>
            <span className="truncate font-medium text-slate-800">{pageTitle}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <NotificationPermissionBadge />
            <span title="Môi trường ứng dụng" className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${environment === "mock" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{environment}</span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 px-6 py-6 outline-none 2xl:px-8">
          <Outlet />
        </main>
      </div>
      <NotificationToastContainer />
    </div>
  );
}
