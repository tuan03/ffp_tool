import { NavLink, Outlet } from "react-router-dom";

import { environment } from "../config/environment";

export function AppLayout(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top Application Navbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <NavLink to="/pinterest-pod" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 text-xs font-bold text-slate-950 shadow-md shadow-cyan-500/20">
                FP
              </span>
              <span className="text-sm font-bold tracking-wider uppercase text-cyan-400">
                FFP Tool
              </span>
            </NavLink>

            <nav className="flex items-center gap-2 text-xs font-medium">
              <NavLink
                to="/product-crawler"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                🛒 Amazon Crawler
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
                to="/workflow-demo"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-slate-800 font-semibold text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`
                }
              >
                ⚙️ Workflow Demo
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2">
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
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
