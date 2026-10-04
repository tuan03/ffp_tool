import { useEffect, useMemo, useRef, useState } from "react";

import {
  createAmazonCrawlerRunner,
  createAmazonCrawlerClientsLoader,
  createAmazonCrawlerCommandController,
  createAmazonCrawlerAdmissionGateController,
  createAmazonCrawlerJobController,
  createAmazonCrawlerJobLoader,
  createAmazonCrawlerCacheClearer,
  createAmazonCrawlerSyncRetrier,
  createImageProcessingProfileManager,
  createCrawlerOperatorFetch,
  discoverCrawlerOperatorAuth,
} from "../service";
import { AmazonCrawlerPage } from "./AmazonCrawlerPage";
import type { AmazonCrawlerPageProps } from "./AmazonCrawlerPage";

export function AuthenticatedCrawlerPage({ engineUrl, ...original }: AmazonCrawlerPageProps & { engineUrl?: string }) {
  const [mode, setMode] = useState<"checking" | "legacy" | "secure" | "error">(engineUrl === undefined ? "legacy" : "checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [session, setSession] = useState<{ fetchImplementation: typeof fetch } | null>(null);
  const activeSession = useRef<AbortController | null>(null);
  const isMounted = useRef(false);
  useEffect(() => {
    let mounted = true;
    isMounted.current = true;
    setSession(null);
    setPassword("");
    setMode(engineUrl === undefined ? "legacy" : "checking");
    if (engineUrl !== undefined) {
      void (async () => {
        try {
          const required = await discoverCrawlerOperatorAuth(engineUrl);
          if (mounted) setMode(required ? "secure" : "legacy");
        } catch {
          if (mounted) {
            setMode("error");
            setError("Không kiểm tra được Coordinator. Hãy tải lại trang.");
          }
        }
      })();
    }
    return () => {
      mounted = false;
      isMounted.current = false;
      activeSession.current?.abort();
    };
  }, [engineUrl]);
  const authenticated = useMemo(() => {
    if (!session) return null;
    const options = { engineUrl: engineUrl ?? "", fetchImplementation: session.fetchImplementation };
    return {
      runAmazonCrawler: createAmazonCrawlerRunner(options),
      loadAmazonCrawlerClients: createAmazonCrawlerClientsLoader(options),
      amazonCrawlerCommands: createAmazonCrawlerCommandController(options),
      amazonCrawlerAdmissionGate: createAmazonCrawlerAdmissionGateController(options),
      amazonCrawlerJobs: createAmazonCrawlerJobController(options),
      loadAmazonCrawlerJob: createAmazonCrawlerJobLoader(options),
      clearAmazonCrawlerCache: createAmazonCrawlerCacheClearer(options),
      retryAmazonCrawlerSyncs: createAmazonCrawlerSyncRetrier(options),
      imageProcessingProfiles: createImageProcessingProfileManager(options),
    };
  }, [session, engineUrl]);
  function handleLogout(): void {
    activeSession.current?.abort();
    activeSession.current = null;
    setSession(null);
    setPassword("");
  }
  async function handleLogin(): Promise<void> {
    if (isBusy) return;
    setIsBusy(true);
    setError("");
    const controller = new AbortController();
    activeSession.current = controller;
    try {
      const fetchImplementation = createCrawlerOperatorFetch({
        engineUrl: engineUrl ?? "", username, password,
        sessionSignal: controller.signal, onUnauthorized: handleLogout,
      });
      await createAmazonCrawlerClientsLoader({ engineUrl: engineUrl ?? "", fetchImplementation })();
      if (!isMounted.current || controller.signal.aborted) return;
      setSession({ fetchImplementation });
      setPassword("");
    } catch {
      controller.abort();
      if (isMounted.current) setError("Đăng nhập không thành công. Kiểm tra tài khoản operator và kết nối.");
    } finally {
      if (isMounted.current) setIsBusy(false);
    }
  }
  if (mode === "legacy") return <AmazonCrawlerPage {...original} />;
  if (mode === "checking") return <p role="status">Đang kiểm tra xác thực Coordinator…</p>;
  if (mode === "error") return <p role="alert">{error}</p>;
  if (authenticated) return <><div className="flex justify-end p-3"><button type="button" onClick={handleLogout}>Đăng xuất operator</button></div><AmazonCrawlerPage {...original} {...authenticated} /></>;
  return <form className="mx-auto flex max-w-md flex-col gap-4 p-6" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
    <h1 className="text-xl font-semibold">Đăng nhập Crawler Operator</h1>
    <p>Credential chỉ giữ trong bộ nhớ trang và chỉ gửi tới API crawler đã cấu hình.</p>
    <label>Operator<input className="w-full rounded border bg-slate-900 p-2" autoComplete="off" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>Mật khẩu<input className="w-full rounded border bg-slate-900 p-2" type="password" autoComplete="off" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="submit" disabled={isBusy}>{isBusy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
