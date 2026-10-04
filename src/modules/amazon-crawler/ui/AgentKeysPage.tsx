import { useState } from "react";

import { requestAgentKeyManagement } from "../service";
import type { AgentKeySummary } from "../service";

export function AgentKeysPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [maxWorkers, setMaxWorkers] = useState(2);
  const [environment, setEnvironment] = useState("test");
  const [allowPinterest, setAllowPinterest] = useState(false);
  const [keys, setKeys] = useState<AgentKeySummary[]>([]);
  const [rawKey, setRawKey] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  async function handleAction(action: "list" | "create" | "rotate" | "revoke", keyId?: string, rebind = false) {
    if (window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      setError("Chỉ dùng quản lý key qua HTTPS hoặc localhost.");
      return;
    }
    if (!username || !password) { setError("Nhập tài khoản operator."); return; }
    if (action !== "list" && rawKey) { setError("Hãy lưu và đóng key đang hiển thị trước."); return; }
    if ((action === "revoke" || action === "rotate") && !window.confirm(rebind
      ? "Cấp lại quyền đăng ký cho identity này và vô hiệu hóa key cũ?"
      : "Key cũ sẽ mất hiệu lực. Tiếp tục?")) return;
    setIsBusy(true);
    setError("");
    try {
      const previous = keys.find((key) => key.id === keyId);
      const response = await requestAgentKeyManagement({ username, password, action, keyId,
        payload: { requestId: crypto.randomUUID(), name: previous?.name ?? (name.trim() || "Crawler agent"),
          maxWorkers: previous?.maxWorkers ?? maxWorkers,
          crawlers: previous?.crawlers ?? (allowPinterest ? ["amazon", "pinterest"] : ["amazon"]),
          environment: previous?.environment ?? environment,
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), ...(action === "rotate" ? { rebind } : {}) },
      });
      if (response.key) setRawKey(response.key);
      if (action === "list") { setKeys(response.keys); setHasLoaded(true); }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Không thể quản lý key.");
    } finally { setIsBusy(false); }
  }

  const inputClass = "rounded border border-slate-600 bg-slate-900 p-2";
  return <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
    <h1 className="text-2xl font-semibold">Crawler Agent Keys</h1>
    <p>Chỉ operator quản lý key. Mật khẩu và key chỉ giữ trong bộ nhớ trang, không lưu browser storage.
      Key tạo mới có hạn 30 ngày. Rotate giữ identity; Rebind cho phép đăng ký lại identity đó.</p>
    <label className="flex flex-col gap-1">Operator<input className={inputClass} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label className="flex flex-col gap-1">Mật khẩu<input type="password" className={inputClass} autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label className="flex flex-col gap-1">Tên key<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="flex flex-col gap-1">Số worker tối đa<input type="number" min={1} max={16} className={inputClass} value={maxWorkers} onChange={(event) => setMaxWorkers(Number(event.target.value))} /></label>
    <label className="flex flex-col gap-1">Môi trường<select className={inputClass} value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="test">Test</option><option value="production">Production</option></select></label>
    <label><input type="checkbox" checked={allowPinterest} onChange={(event) => setAllowPinterest(event.target.checked)} /> Cho phép Pinterest (ngoài Amazon)</label>
    <div className="flex gap-4"><button type="button" disabled={isBusy} onClick={() => void handleAction("list")}>Tải danh sách</button>
      <button type="button" disabled={isBusy} onClick={() => void handleAction("create")}>Tạo key</button>
      <button type="button" onClick={() => { setPassword(""); setRawKey(""); setKeys([]); setHasLoaded(false); }}>Xóa thông tin khỏi trang</button></div>
    {isBusy && <p role="status">Đang xử lý…</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {rawKey && <section className="flex flex-col gap-2 rounded border border-amber-500 p-4"><p>Key chỉ hiển thị một lần. Lưu riêng an toàn, không đưa vào Git/chat.</p>
      <label>Agent Key<input readOnly autoComplete="off" className={`${inputClass} w-full`} value={rawKey} /></label>
      <button type="button" onClick={() => setRawKey("")}>Đã lưu, đóng key</button></section>}
    {hasLoaded && keys.length === 0 && <p>Chưa có key.</p>}
    <ul className="flex flex-col gap-3">{keys.map((key) => <li key={key.id} className="rounded border border-slate-600 p-3">
      <p>{key.name} — {key.status} — {key.agentId ?? "Chưa đăng ký"}</p>
      <div className="flex gap-4"><button type="button" disabled={isBusy} onClick={() => void handleAction("rotate", key.id)}>Rotate</button>
        <button type="button" disabled={isBusy} onClick={() => void handleAction("rotate", key.id, true)}>Rebind</button>
        <button type="button" disabled={isBusy} onClick={() => void handleAction("revoke", key.id)}>Revoke</button></div>
    </li>)}</ul>
    <p>Danh sách hiển thị tối đa 50 key đầu. Tải lại sau thao tác để xem trạng thái mới.</p>
  </main>;
}
