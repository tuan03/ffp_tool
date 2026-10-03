import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { environment } from "../config/environment";
import {
  ACTIVE_STORE_CHANGED_EVENT,
  buildStoreAwarePath,
  normalizeActiveStoreId,
  persistActiveStoreId,
  readActiveStoreId,
} from "../shared/active-store";
import { NotificationPermissionBadge } from "./components/NotificationPermissionBadge";
import { NotificationToastContainer } from "./components/NotificationToastContainer";

export function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const queryStoreId = useMemo(
    () => normalizeActiveStoreId(new URLSearchParams(location.search).get("storeId")),
    [location.search],
  );
  const [activeStoreId, setActiveStoreId] = useState(() => {
    if (queryStoreId) return queryStoreId;
    return typeof window === "undefined" ? "" : readActiveStoreId(window.localStorage);
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

  const queuePath = buildStoreAwarePath("/gpt-seo", activeStoreId);
  const autoSeoPath = buildStoreAwarePath("/auto-seo", activeStoreId);
  const reviewPath = buildStoreAwarePath("/seo-review", activeStoreId);
  const performancePath = buildStoreAwarePath("/seo-performance", activeStoreId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top Application Navbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex w-full min-w-0 items-center gap-3 lg:w-auto lg:flex-1 lg:gap-6">
            <NavLink to="/amazon-crawler" className="flex shrink-0 items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 text-xs font-bold text-slate-950 shadow-md shadow-cyan-500/20">
                FP
              </span>
              <span className="text-sm font-bold tracking-wider uppercase text-cyan-400">
                FFP Tool
              </span>
            </NavLink>

            <nav aria-label="Điều hướng ứng dụng" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-xs font-medium lg:whitespace-normal [&>a]:shrink-0 lg:[&>a]:shrink">
              <NavLink to={performancePath} className={({ isActive }) => `rounded-lg px-3 py-1.5 ${isActive ? "bg-slate-800 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}>SEO Performance</NavLink>
              <NavLink
                to={queuePath}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                ✦ SEO Queue
              </NavLink>
              <NavLink
                to="/amazon-crawler"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                ⚡ Distributed Crawler
              </NavLink>

              <NavLink
                to="/pinterest-pod"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                🎨 Pinterest POD Studio
              </NavLink>

              <NavLink
                to={autoSeoPath}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                ✨ Auto SEO
              </NavLink>

              <NavLink
                to={reviewPath}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                📝 SEO Review
              </NavLink>

              <NavLink
                to="/customization"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                🎛️ Customizer
              </NavLink>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <NotificationPermissionBadge />

            <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
              <span className="text-[11px] text-slate-500 font-mono">env:</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                  environment === "mock"
                    ? "bg-amber-950/70 border border-amber-800 text-amber-300"
                    : environment === "production"
                      ? "bg-emerald-950/70 border border-emerald-800 text-emerald-300"
                      : "bg-cyan-950/70 border border-cyan-800 text-cyan-300"
                }`}
              >
                {environment}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>

      {/* Floating In-App Toast Container */}
      <NotificationToastContainer />
    </div>
  );
}
