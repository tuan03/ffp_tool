import { NavLink, Outlet } from "react-router-dom";

import { environment } from "../config/environment";

export function AppLayout(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <section className="mx-auto w-full max-w-7xl rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-400">FFP Tool</p>
            <nav className="flex gap-3 text-sm">
              <NavLink className={({ isActive }) => isActive ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"} end to="/">Home</NavLink>
              <NavLink className={({ isActive }) => isActive ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"} to="/amazon-crawler">Amazon Crawler</NavLink>
            </nav>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">
            {environment}
          </span>
        </header>
        <Outlet />
      </section>
    </main>
  );
}
