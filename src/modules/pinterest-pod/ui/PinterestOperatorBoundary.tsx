import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { requestPinterestOperatorSession } from "../service";

export function PinterestOperatorBoundary({ children, enabled }: { children: ReactNode; enabled: boolean }): ReactNode {
  const [session, setSession] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let isMounted = true;
    async function refresh(): Promise<void> {
      try {
        const current = await requestPinterestOperatorSession("status");
        if (isMounted) { setSession(current); setError(""); }
      } catch {
        if (isMounted) { setSession(null); setError("Không kiểm tra được Pinterest operator. Hãy kiểm tra kết nối."); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { isMounted = false; window.clearInterval(timer); };
  }, [enabled]);
  async function handleLogin(): Promise<void> {
    setIsBusy(true);
    try {
      setSession(await requestPinterestOperatorSession("login", { username, password }));
      setError("");
    } catch {
      setError("Đăng nhập không thành công. Kiểm tra tài khoản operator và Coordinator.");
    } finally {
      setPassword("");
      setIsBusy(false);
    }
  }
  async function handleLogout(): Promise<void> {
    try {
      await requestPinterestOperatorSession("logout");
      setSession({ authRequired: true, authenticated: false });
      setError("");
    } catch {
      setError("Chưa đăng xuất được trên server. Hãy thử lại.");
    }
  }
  if (!enabled || session?.authRequired === false) return children;
  if (session?.authenticated) return <>
    <div className="flex justify-end p-3"><button type="button" onClick={() => { void handleLogout(); }}>Đăng xuất Pinterest operator</button></div>
    {error && <p role="alert">{error}</p>}{children}
  </>;
  if (!session) return <p role={error ? "alert" : "status"}>{error || "Đang kiểm tra Pinterest operator…"}</p>;
  return <form className="mx-auto flex max-w-md flex-col gap-4 p-6" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
    <h1 className="text-xl font-semibold">Đăng nhập Pinterest Operator</h1>
    <p>Phiên có thời hạn một giờ. Mật khẩu không được lưu trong browser storage.</p>
    <label>Operator<input required autoComplete="off" className="w-full rounded border bg-slate-900 p-2" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>Mật khẩu<input required type="password" autoComplete="off" className="w-full rounded border bg-slate-900 p-2" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="submit" disabled={isBusy}>{isBusy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
