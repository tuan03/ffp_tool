import React, { useState, useEffect, useCallback } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../../shared/hooks/useDialogFocus";
import type { AdsIntelligenceClient, AdsGatewayStore, McpUserToken, McpAuditLog } from "../../types";

export interface McpModalProps {
  readonly onClose: () => void;
  readonly client?: AdsIntelligenceClient;
  readonly stores?: readonly AdsGatewayStore[];
}

type TabType = "install" | "users" | "audit";

export function McpModal({ onClose, client, stores = [] }: McpModalProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>("install");
  const [users, setUsers] = useState<readonly McpUserToken[]>([]);
  const [auditLogs, setAuditLogs] = useState<readonly McpAuditLog[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [selectedUserToken, setSelectedUserToken] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Form state for creating new user
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"media_buyer" | "viewer" | "admin">("media_buyer");
  const [allStoresAllowed, setAllStoresAllowed] = useState(true);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [creatingUser, setCreatingUser] = useState(false);
  const dialogRef = useDialogFocus({ isOpen: true, onClose: () => { if (!creatingUser) onClose(); } });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUserSuccess, setCreatedUserSuccess] = useState<McpUserToken | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://ffp.b6-team.site";

  const fetchUsers = useCallback(async () => {
    if (!client?.listMcpUsers) return;
    setLoadingUsers(true);
    try {
      const res = await client.listMcpUsers();
      setUsers(res.users || []);
      if (res.users && res.users.length > 0 && !selectedUserToken) {
        setSelectedUserToken(res.users[0].token);
      }
    } catch (err) {
      console.error("Failed to load MCP users:", err);
    } finally {
      setLoadingUsers(false);
    }
  }, [client, selectedUserToken]);

  const fetchAudit = useCallback(async () => {
    if (!client?.getMcpAuditLogs) return;
    setLoadingAudit(true);
    try {
      const res = await client.getMcpAuditLogs(100);
      setAuditLogs(res.auditLogs || []);
    } catch (err) {
      console.error("Failed to load MCP audit logs:", err);
    } finally {
      setLoadingAudit(false);
    }
  }, [client]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAudit();
    }
  }, [activeTab, fetchAudit]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client?.createMcpUser || !newUserName.trim()) return;
    setCreatingUser(true);
    setCreateError(null);
    try {
      const allowedStores = allStoresAllowed ? ["*"] : selectedStores;
      const res = await client.createMcpUser({
        name: newUserName.trim(),
        allowedStores,
        role: newUserRole,
      });
      if (res.success && res.user) {
        setCreatedUserSuccess(res.user);
        setSelectedUserToken(res.user.token);
        setNewUserName("");
        setSelectedStores([]);
        setAllStoresAllowed(true);
        fetchUsers();
      }
    } catch (err: any) {
      setCreateError(err.message || "Không thể tạo token.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleRevoke = async (userId: string) => {
    if (!client?.revokeMcpUser) return;
    try {
      await client.revokeMcpUser(userId);
      fetchUsers();
    } catch (err) {
      console.error("Error revoking user:", err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!client?.deleteMcpUser) return;
    if (!confirm("Bạn có chắc chắn muốn xóa token này vĩnh viễn?")) return;
    try {
      await client.deleteMcpUser(userId);
      fetchUsers();
    } catch (err) {
      console.error("Error deleting user:", err);
    }
  };

  const [installerOs, setInstallerOs] = useState<"windows" | "unix">("windows");

  const currentToken = selectedUserToken || "<CHƯA_CHỌN_TOKEN>";
  const installCommandWindows = `irm "${baseUrl}/mcp/ads/install.ps1?token=${currentToken}" | iex`;
  const installCommandUnix = `curl -fsSL "${baseUrl}/mcp/ads/install.sh?token=${currentToken}" | bash`;
  const installCommand = installerOs === "windows" ? installCommandWindows : installCommandUnix;
  const agyManualCommand = `agy mcp add --header "Authorization: Bearer ${currentToken}" ads-intelligence "${baseUrl}/mcp/ads"`;

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Kết nối MCP & quản lý truy cập" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4 animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-2xl shadow-sm ">
              <AppIcon name="code" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                FFP Ads Intelligence MCP — Multi-User & 1-Click Setup
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Phân quyền theo từng nhân sự (RBAC), theo dõi Tool Call Audit Trail và cài đặt 1 chạm cho Antigravity CLI / Codex / Claude Desktop
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 p-1 rounded-lg text-lg cursor-pointer transition"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2 text-xs font-semibold shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("install")}
            className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-2 ${
              activeTab === "install"
                ? "bg-blue-600 text-white shadow-md "
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            <AppIcon name="seo" /> Cài đặt 1-Click Client
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("users")}
            className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-2 ${
              activeTab === "users"
                ? "bg-blue-600 text-white shadow-md "
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            👥 Quản lý Nhân sự & Cấp Token ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-2 ${
              activeTab === "audit"
                ? "bg-blue-600 text-white shadow-md "
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            📜 Nhật ký Audit Trail
          </button>
        </div>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
          
          {/* TAB 1: 1-CLICK INSTALLER */}
          {activeTab === "install" && (
            <div className="space-y-4">
              {/* Select User Token */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-1.5">
                    <span>👤</span> Chọn Token Nhân sự để sinh lệnh cài đặt:
                  </label>
                  {users.length > 0 ? (
                    <select
                      value={selectedUserToken}
                      onChange={(e) => setSelectedUserToken(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-blue-700 dark:text-blue-300 font-mono focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.token}>
                          {u.name} ({u.allowedStores.includes("*") ? "Toàn bộ Store" : u.allowedStores.join(", ")}) — {u.status}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300 text-xs">
                      Chưa có token cá nhân nào. Hãy chuyển sang tab "Quản lý Nhân sự" để tạo token.
                    </span>
                  )}
                </div>
              </div>

              {/* 1-Click Multi-OS Command Box */}
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-700 animate-pulse"></span>
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold text-xs">Lệnh cài đặt 1 chạm:</span>
                    <div className="inline-flex rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setInstallerOs("windows")}
                        className={`px-2.5 py-1 rounded-md transition cursor-pointer flex items-center gap-1 ${
                          installerOs === "windows"
                            ? "bg-blue-600 text-white shadow"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                      >
                        <span>🪟</span> Windows (PowerShell)
                      </button>
                      <button
                        type="button"
                        onClick={() => setInstallerOs("unix")}
                        className={`px-2.5 py-1 rounded-md transition cursor-pointer flex items-center gap-1 ${
                          installerOs === "unix"
                            ? "bg-blue-600 text-white shadow"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                      >
                        <span>🍎 / 🐧</span> macOS &amp; Linux (Bash)
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(installCommand, "install")}
                    className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition cursor-pointer flex items-center gap-1.5 shadow self-start sm:self-auto"
                  >
                    {copiedText === "install" ? "✓ Đã sao chép!" : "📋 Sao chép Lệnh"}
                  </button>
                </div>
                <div className="rounded-lg bg-black/80 border border-slate-200 dark:border-slate-700 p-3 font-mono text-xs text-white break-all select-all">
                  {installCommand}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {installerOs === "windows" ? (
                    <><AppIcon name="info" /> <b>Cách dùng:</b> Mở <b>PowerShell</b> trên máy tính Windows và dán lệnh trên rồi Enter. Script sẽ tự động nhận diện và cấu hình cho <b>Antigravity CLI (agy)</b>, <b>Codex (~/.codex/config.toml)</b> và <b>Claude Desktop</b>.</>
                  ) : (
                    <><AppIcon name="info" /> <b>Cách dùng:</b> Mở <b>Terminal (Zsh / Bash)</b> trên máy Mac hoặc Linux và dán lệnh trên rồi Enter. Script sẽ tự động cấu hình cho <b>Antigravity CLI (agy)</b> và <b>Codex (~/.codex/config.toml)</b>.</>
                  )}
                </p>
              </div>

              {/* Manual Configuration for Antigravity & Codex */}
              <div className="space-y-3">
                <h4 className="font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider text-xs">
                  Cấu hình thủ công (Tùy chọn)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Antigravity CLI */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2">
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span><AppIcon name="seo" /> Google Antigravity CLI</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(agyManualCommand, "agy")}
                        className="text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 text-xs cursor-pointer"
                      >
                        {copiedText === "agy" ? "✓ Đã copy" : "Copy"}
                      </button>
                    </div>
                    <pre className="p-2 rounded bg-black/60 border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                      {agyManualCommand}
                    </pre>
                  </div>

                  {/* Codex config.toml */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2">
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span>💻 Codex (~/.codex/config.toml)</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(`[mcp_servers.ads_intelligence]\nurl = "${baseUrl}/mcp/ads"\nhttp_headers = { "Authorization" = "Bearer ${currentToken}" }`, "codex")}
                        className="text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 text-xs cursor-pointer"
                      >
                        {copiedText === "codex" ? "✓ Đã copy" : "Copy"}
                      </button>
                    </div>
                    <pre className="p-2 rounded bg-black/60 border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
{`[mcp_servers.ads_intelligence]
url = "${baseUrl}/mcp/ads"
http_headers = { "Authorization" = "Bearer ${currentToken}" }`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Endpoint Specs */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-1.5 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">MCP Stream Endpoint:</span>
                  <span className="text-blue-700 dark:text-blue-300 font-bold">{baseUrl}/mcp/ads</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Protocol Spec:</span>
                  <span className="text-blue-700 dark:text-blue-300">2024-11-05 (Streamable HTTP JSON-RPC 2.0)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Total Tools Available:</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold">37 Tools (Read, Research, Guarded Writes, Briefs, Experiments)</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USER & TOKEN MANAGEMENT */}
          {activeTab === "users" && (
            <div className="space-y-4">
              {/* Add New User Token Form */}
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 p-4 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>➕</span> Cấp Token MCP Mới Cho Nhân Viên
                </h4>
                <form onSubmit={handleCreateUser} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium">Tên nhân viên / Thiết bị:</label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Hiep Laptop, Y PC, Loi Macbook"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium">Vai trò (Role):</label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as any)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                      >
                        <option value="media_buyer">Media Buyer (Đọc KPI, Sinh Brief, Quản lý Thử nghiệm)</option>
                        <option value="viewer">Viewer (Chỉ đọc số liệu, không sinh brief/thử nghiệm)</option>
                        <option value="admin">Admin (Toàn quyền tất cả công cụ)</option>
                      </select>
                    </div>
                  </div>

                  {/* Store RBAC Selection */}
                  <div className="space-y-2 pt-1">
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block">
                      Phân quyền Store (Store-level RBAC):
                    </label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="storeAccess"
                          checked={allStoresAllowed}
                          onChange={() => setAllStoresAllowed(true)}
                          className="text-blue-600 dark:text-blue-400 focus:ring-blue-300 dark:focus:ring-blue-400"
                        />
                        <span>Tất cả các Stores (*)</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="storeAccess"
                          checked={!allStoresAllowed}
                          onChange={() => setAllStoresAllowed(false)}
                          className="text-blue-600 dark:text-blue-400 focus:ring-blue-300 dark:focus:ring-blue-400"
                        />
                        <span>Chỉ các Store được chọn</span>
                      </label>
                    </div>

                    {!allStoresAllowed && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        {stores.map((s) => {
                          const checked = selectedStores.includes(s.storeId);
                          return (
                            <label
                              key={s.storeId}
                              className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition ${
                                checked ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedStores([...selectedStores, s.storeId]);
                                  } else {
                                    setSelectedStores(selectedStores.filter((id) => id !== s.storeId));
                                  }
                                }}
                                className="rounded text-blue-600 dark:text-blue-400 focus:ring-blue-300 dark:focus:ring-blue-400"
                              />
                              <span className="font-mono text-xs">{s.storeId}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {createError && (
                    <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
                      {createError}
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={creatingUser || !newUserName.trim()}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs transition cursor-pointer shadow-md "
                    >
                      {creatingUser ? "Đang tạo..." : "✨ Tạo Token Mới"}
                    </button>
                  </div>
                </form>

                {/* Show Newly Created Token Callout */}
                {createdUserSuccess && (
                  <div className="mt-3 p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center gap-1.5">
                        <span>🎉</span> Đã tạo thành công Token cho {createdUserSuccess.name}!
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(createdUserSuccess.token, "new-token")}
                        className="px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-700 text-white text-xs font-semibold transition cursor-pointer"
                      >
                        {copiedText === "new-token" ? "✓ Đã copy token" : "Copy Token"}
                      </button>
                    </div>
                    <div className="font-mono text-xs text-emerald-700 dark:text-emerald-300 bg-black/60 p-2 rounded border border-emerald-200 dark:border-emerald-800 break-all select-all">
                      {createdUserSuccess.token}
                    </div>
                  </div>
                )}
              </div>

              {/* Existing Users Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider text-xs">
                    Danh sách Nhân sự đã cấp quyền ({users.length})
                  </h4>
                  <button
                    type="button"
                    onClick={fetchUsers}
                    disabled={loadingUsers}
                    className="text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 text-xs cursor-pointer"
                  >
                    {loadingUsers ? "Đang tải..." : "🔄 Làm mới"}
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs uppercase font-semibold">
                        <th className="p-2.5">Nhân viên</th>
                        <th className="p-2.5">Token</th>
                        <th className="p-2.5">Store được phép</th>
                        <th className="p-2.5">Lần cuối dùng</th>
                        <th className="p-2.5">Trạng thái</th>
                        <th className="p-2.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-500 dark:text-slate-400">
                            Chưa có nhân viên nào được cấp token cá nhân.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => {
                          const isRevoked = u.status === "REVOKED";
                          return (
                            <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                              <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100">
                                <div>{u.name}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{u.role}</div>
                              </td>
                              <td className="p-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                                <div className="flex items-center gap-1.5">
                                  <span>{u.token.slice(0, 16)}...{u.token.slice(-4)}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(u.token, u.id)}
                                    className="text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 text-xs cursor-pointer"
                                  >
                                    {copiedText === u.id ? "✓" : "📋"}
                                  </button>
                                </div>
                              </td>
                              <td className="p-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {u.allowedStores.map((s) => (
                                    <span
                                      key={s}
                                      className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-mono"
                                    >
                                      {s === "*" ? "Tất cả (*)" : s}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="p-2.5 text-slate-600 dark:text-slate-400 text-xs">
                                {u.lastUsedAt ? new Date(u.lastUsedAt).toLocaleString("vi-VN") : "Chưa gọi"}
                              </td>
                              <td className="p-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    isRevoked
                                      ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                                      : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                  }`}
                                >
                                  {isRevoked ? "ĐÃ THU HỒI" : "HOẠT ĐỘNG"}
                                </span>
                              </td>
                              <td className="p-2.5 text-right space-x-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleRevoke(u.id)}
                                  className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer transition ${
                                    isRevoked
                                      ? "bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300"
                                      : "bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-50 dark:hover:bg-amber-950/80 text-amber-700 dark:text-amber-300"
                                  }`}
                                >
                                  {isRevoked ? "Khôi phục" : "Thu hồi"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-50 dark:hover:bg-rose-950/80 text-rose-700 dark:text-rose-300 text-xs font-semibold cursor-pointer transition"
                                >
                                  Xóa
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT TRAIL LOGS */}
          {activeTab === "audit" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider text-xs">
                    Lịch sử Gọi Công cụ MCP (Real-time Tool Execution Audit)
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Ghi nhận minh bạch ai đã gọi công cụ gì, trên store nào và kết quả ra sao.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchAudit}
                  disabled={loadingAudit}
                  className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-blue-700 dark:text-blue-300 text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                >
                  {loadingAudit ? "Đang tải..." : "🔄 Làm mới"}
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs uppercase font-semibold">
                      <th className="p-2.5">Thời gian</th>
                      <th className="p-2.5">Nhân viên</th>
                      <th className="p-2.5">Công cụ (Tool Name)</th>
                      <th className="p-2.5">Store ID</th>
                      <th className="p-2.5">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate-500 dark:text-slate-400">
                          Chưa có lượt gọi tool nào được ghi nhận.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                          <td className="p-2.5 text-slate-600 dark:text-slate-400 text-xs font-mono">
                            {new Date(log.timestamp).toLocaleString("vi-VN")}
                          </td>
                          <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100">
                            {log.userName}
                          </td>
                          <td className="p-2.5 font-mono text-xs text-blue-700 dark:text-blue-300 font-semibold">
                            {log.toolName}
                          </td>
                          <td className="p-2.5 font-mono text-xs text-blue-700 dark:text-blue-300">
                            {log.storeId || "—"}
                          </td>
                          <td className="p-2.5">
                            {log.success ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                THÀNH CÔNG
                              </span>
                            ) : (
                              <span
                                title={log.error}
                                className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 cursor-help"
                              >
                                TỪ CHỐI / LỖI
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between items-center shrink-0">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            FFP Ads Intelligence v1.0.0 • Safe MCP Architecture
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 font-semibold text-xs transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
