import { Outlet } from "react-router-dom";

import { environment } from "../config/environment";

export function AppLayout(): React.JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-50">
      <section className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-400">FFP Tool</p>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">
            {environment}
          </span>
        </header>
        <Outlet />
      </section>
    </main>
  );
}
