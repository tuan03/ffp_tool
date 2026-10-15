import React, { useEffect, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../../shared/hooks/useDialogFocus";
import type { AdsIntelligenceClient, MetaAdAccountInfo } from "../../types";

export interface StoreProfileModalProps {
  readonly storeId: string;
  readonly shopDomain?: string;
  readonly client: AdsIntelligenceClient;
  readonly onClose: () => void;
  readonly onSaved: (storeId: string) => void;
}

const GA4_SERVICE_ACCOUNT_EMAIL = "ga4-data-reader@vaulted-night-510508-j8.iam.gserviceaccount.com";

export function StoreProfileModal({
  storeId,
  shopDomain,
  client,
  onClose,
  onSaved,
}: StoreProfileModalProps): React.JSX.Element {
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus({ isOpen: true, onClose: () => { if (!saving) onClose(); } });
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Meta Test State
  const [testingMeta, setTestingMeta] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<{
    success: boolean;
    name?: string;
    currency?: string;
    timezone?: string;
    error?: string;
  } | null>(null);

  // Meta Available Accounts State
  const [availableAccounts, setAvailableAccounts] = useState<readonly MetaAdAccountInfo[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [manualMetaMode, setManualMetaMode] = useState(false);

  // GA4 Test State
  const [testingGa4, setTestingGa4] = useState(false);
  const [ga4TestResult, setGa4TestResult] = useState<{
    success: boolean;
    propertyId?: string;
    sessions?: number;
    currency?: string;
    error?: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form Fields
  const [metaAccountId, setMetaAccountId] = useState("");
  const [accountTimezone, setAccountTimezone] = useState("Asia/Manila");
  const [targetCpa, setTargetCpa] = useState("22");
  const [breakEvenRoas, setBreakEvenRoas] = useState("2.2");
  const [ga4PropertyId, setGa4PropertyId] = useState("");

  // JSON Raw Field
  const [rawJson, setRawJson] = useState("");

  // Load available Meta accounts on mount
  useEffect(() => {
    let active = true;
    if (!client.listMetaAdAccounts) return;
    setLoadingAccounts(true);
    client
      .listMetaAdAccounts()
      .then((res) => {
        if (!active) return;
        if (res.success && res.accounts && res.accounts.length > 0) {
          setAvailableAccounts(res.accounts);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingAccounts(false);
      });

    return () => {
      active = false;
    };
  }, [client]);

  // Auto-match account if metaAccountId is not yet set
  useEffect(() => {
    if (!availableAccounts.length || metaAccountId) return;
    const cleanStore = storeId.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanDomain = (shopDomain || "").toLowerCase().replace(/\.myshopify\.com$/, "").replace(/[^a-z0-9]/g, "");

    const matched = availableAccounts.find((acc) => {
      const accName = acc.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (cleanStore && accName.includes(cleanStore)) || (cleanDomain && accName.includes(cleanDomain));
    });

    if (matched) {
      setMetaAccountId(matched.id);
      if (matched.timezone_name) {
        setAccountTimezone(matched.timezone_name);
      }
    }
  }, [availableAccounts, metaAccountId, storeId, shopDomain]);

  // Load existing profile on open if available
  useEffect(() => {
    let active = true;
    if (!client.getStoreProfile) return;
    setLoading(true);
    void client
      .getStoreProfile(storeId)
      .then((res) => {
        if (!active || !res?.profile) return;
        const p = res.profile;
        if (p.meta?.accountIds?.[0]) setMetaAccountId(p.meta.accountIds[0]);
        if (p.meta?.accountTimezone) setAccountTimezone(p.meta.accountTimezone);
        if (p.business?.targetCpa !== undefined && p.business?.targetCpa !== null)
          setTargetCpa(String(p.business.targetCpa));
        if (p.business?.breakEvenRoas !== undefined && p.business?.breakEvenRoas !== null)
          setBreakEvenRoas(String(p.business.breakEvenRoas));
        if (p.ga4?.propertyId) setGa4PropertyId(String(p.ga4.propertyId));
        setRawJson(JSON.stringify(p, null, 2));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client, storeId]);

  const handleCopyEmail = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(GA4_SERVICE_ACCOUNT_EMAIL);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 3000);
    }
  };

  const handleTestMeta = async () => {
    if (!metaAccountId.trim()) {
      setErrorMessage("Vui lòng nhập Meta Ad Account ID để kiểm tra.");
      return;
    }
    setTestingMeta(true);
    setMetaTestResult(null);
    setErrorMessage(null);
    try {
      if (client.testMetaConnection) {
        const res = await client.testMetaConnection(metaAccountId.trim());
        if (res.success && res.account) {
          setMetaTestResult({
            success: true,
            name: res.account.name,
            currency: res.account.currency,
            timezone: res.account.timezone,
          });
          if (res.account.timezone) setAccountTimezone(res.account.timezone);
        } else {
          setMetaTestResult({ success: false, error: res.error || "Không thể kết nối tài khoản Meta." });
        }
      }
    } catch (err) {
      setMetaTestResult({
        success: false,
        error: err instanceof Error ? err.message : "Kiểm tra kết nối Meta thất bại.",
      });
    } finally {
      setTestingMeta(false);
    }
  };

  const handleTestGa4 = async () => {
    if (!ga4PropertyId.trim()) {
      setErrorMessage("Vui lòng nhập GA4 Property ID để kiểm tra.");
      return;
    }
    setTestingGa4(true);
    setGa4TestResult(null);
    setErrorMessage(null);
    try {
      if (client.testGa4Connection) {
        const res = await client.testGa4Connection(ga4PropertyId.trim());
        if (res.success) {
          setGa4TestResult({
            success: true,
            propertyId: res.propertyId,
            sessions: res.sessions,
            currency: res.currency,
          });
        } else {
          setGa4TestResult({
            success: false,
            error: res.error || "Không thể truy vấn dữ liệu từ GA4 Property này.",
          });
        }
      }
    } catch (err) {
      setGa4TestResult({
        success: false,
        error: err instanceof Error ? err.message : "Kiểm tra kết nối GA4 thất bại.",
      });
    } finally {
      setTestingGa4(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      if (!client.saveStoreProfile) {
        throw new Error("Client chưa hỗ trợ lưu cấu hình store.");
      }

      let payload: unknown;
      if (showAdvancedJson) {
        try {
          payload = JSON.parse(rawJson);
        } catch {
          throw new Error("Dữ liệu JSON không đúng định dạng cú pháp.");
        }
      } else {
        if (!metaAccountId.trim()) {
          throw new Error("Meta Ad Account ID là bắt buộc (ví dụ: act_1569725310249145).");
        }

        payload = {
          storeId,
          shopDomain,
          metaAccountId: metaAccountId.trim(),
          accountTimezone,
          targetCpa: Number(targetCpa) || 22,
          breakEvenRoas: Number(breakEvenRoas) || 2.2,
          ga4PropertyId: ga4PropertyId.trim() || undefined,
          watchlist: [],
        };
      }

      const res = await client.saveStoreProfile(storeId, payload);
      if (res.success) {
        onSaved(storeId);
        onClose();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Lưu cấu hình thất bại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Thiết lập Quảng cáo & Đo lường" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg border border-blue-200 bg-white p-6 shadow-sm space-y-5 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-xl shadow-sm ">
              <AppIcon name="settings" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Thiết lập Quảng cáo & Đo lường: <span className="text-blue-700 font-mono">{storeId}</span>
              </h3>
              <p className="text-xs text-slate-600">
                {shopDomain ? `Shopify: ${shopDomain} · ` : ""}Chỉ cần điền ID, hệ thống tự động kết nối API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-600 py-6 text-center">Đang nạp cấu hình store…</p>
        ) : (
          <div className="space-y-5 text-xs">
            {/* SECTION 1: META ADS */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-blue-700 flex items-center gap-1.5 uppercase tracking-wide text-xs">
                  <span>📘</span> 1. Tài khoản Meta Ads
                </span>
                <div className="flex items-center gap-2">
                  {availableAccounts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setManualMetaMode(!manualMetaMode)}
                      className="text-xs text-blue-700 hover:text-blue-700 underline cursor-pointer"
                    >
                      {manualMetaMode ? "📋 Chọn từ danh sách App" : "✏️ Nhập thủ công"}
                    </button>
                  )}
                  <span className="text-xs text-slate-500">Tự động kết nối qua Meta Graph API</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-900 flex items-center justify-between">
                  <span>Meta Ad Account <span className="text-rose-700">*</span></span>
                  <span className="text-xs text-slate-600 font-normal">
                    {manualMetaMode || availableAccounts.length === 0
                      ? "Dãy số hoặc act_xxxxxxxxxxxxxxx"
                      : "Tự động phát hiện từ Meta App"}
                  </span>
                </label>

                {manualMetaMode || (availableAccounts.length === 0 && !loadingAccounts) ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={metaAccountId}
                      onChange={(e) => setMetaAccountId(e.target.value)}
                      placeholder="Ví dụ: act_1569725310249145 hoặc 1569725310249145"
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-blue-700 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                    />
                    <button
                      type="button"
                      onClick={handleTestMeta}
                      disabled={testingMeta || !metaAccountId.trim()}
                      className="px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-blue-700 border border-slate-300 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {testingMeta ? "Đang test…" : "⚡ Test Meta"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <select
                        value={metaAccountId}
                        disabled={loadingAccounts}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMetaAccountId(val);
                          const acc = availableAccounts.find((a) => a.id === val || `act_${a.id}` === val);
                          if (acc?.timezone_name) {
                            setAccountTimezone(acc.timezone_name);
                          }
                          setMetaTestResult(null);
                        }}
                        className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-blue-700 font-medium text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 cursor-pointer"
                      >
                        <option value="">-- Chọn tài khoản quảng cáo Meta --</option>
                        {metaAccountId && !availableAccounts.some((a) => a.id === metaAccountId || `act_${a.id}` === metaAccountId) && (
                          <option value={metaAccountId}>{metaAccountId} (Tài khoản hiện tại)</option>
                        )}
                        {availableAccounts.map((acc) => {
                          const isMatch =
                            storeId &&
                            (acc.name.toLowerCase().includes(storeId.toLowerCase()) ||
                              storeId.toLowerCase().includes(acc.name.toLowerCase()));
                          return (
                            <option key={acc.id} value={acc.id}>
                              {isMatch ? "⭐ " : ""}{acc.name} ({acc.id.startsWith("act_") ? acc.id : `act_${acc.id}`} · {acc.currency} · {acc.timezone_name})
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={handleTestMeta}
                        disabled={testingMeta || !metaAccountId.trim()}
                        className="px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-blue-700 border border-slate-300 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {testingMeta ? "Đang test…" : "⚡ Test"}
                      </button>
                    </div>
                    {loadingAccounts && (
                      <p className="text-xs text-blue-700 animate-pulse">Đang nạp danh sách Ad Accounts từ Meta App…</p>
                    )}
                  </div>
                )}

                {metaTestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                      metaTestResult.success
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}
                  >
                    <span>{metaTestResult.success ? "✓" : "✕"}</span>
                    {metaTestResult.success ? (
                      <span>
                        Meta xác nhận: <strong>{metaTestResult.name}</strong> ({metaTestResult.currency} · {metaTestResult.timezone})
                      </span>
                    ) : (
                      <span>{metaTestResult.error}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-700 text-xs">Múi giờ tài khoản Meta</label>
                <input
                  type="text"
                  value={accountTimezone}
                  onChange={(e) => setAccountTimezone(e.target.value)}
                  placeholder="Asia/Manila hoặc America/New_York"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-900 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                />
              </div>
            </div>

            {/* SECTION 2: GOOGLE ANALYTICS 4 (1 EMAIL DÙNG CHUNG) */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                <span className="font-bold text-blue-700 flex items-center gap-1.5 uppercase tracking-wide text-xs">
                  <span><AppIcon name="chart" /></span> 2. Google Analytics 4 (GA4)
                </span>
                <span className="text-xs text-emerald-700 font-semibold">1 Email dùng chung cho tất cả store</span>
              </div>

              {/* Service Account Callout Banner */}
              <div className="p-3 rounded-lg bg-slate-50 border border-blue-200 space-y-2">
                <p className="text-xs text-slate-700 leading-relaxed">
                  <AppIcon name="info" /> <strong>Không cần tạo file JSON:</strong> Chỉ cần vào Google Analytics của store này (<em>Admin ➔ Property Access Management</em>), bấm <strong>Add User</strong> và thêm email sau với quyền <strong>Viewer</strong>:
                </p>
                <div className="flex items-center justify-between gap-2 bg-white p-2 rounded border border-slate-200 font-mono text-xs text-blue-700">
                  <span className="truncate select-all">{GA4_SERVICE_ACCOUNT_EMAIL}</span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="shrink-0 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-sans text-xs font-semibold transition cursor-pointer"
                  >
                    {copiedEmail ? "✓ Đã chép" : "📋 Sao chép email"}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-900 flex items-center justify-between">
                  <span>GA4 Property ID (Dãy số)</span>
                  <span className="text-xs text-slate-600 font-normal">Xem trong GA4 Property Settings</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ga4PropertyId}
                    onChange={(e) => setGa4PropertyId(e.target.value)}
                    placeholder="Ví dụ: 555699138"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-blue-700 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                  />
                  <button
                    type="button"
                    onClick={handleTestGa4}
                    disabled={testingGa4 || !ga4PropertyId.trim()}
                    className="px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {testingGa4 ? "Đang test…" : "⚡ Test GA4"}
                  </button>
                </div>

                {ga4TestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                      ga4TestResult.success
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}
                  >
                    <span>{ga4TestResult.success ? "✓" : "✕"}</span>
                    {ga4TestResult.success ? (
                      <span>
                        GA4 xác nhận: Kết nối thành công! Đã ghi nhận <strong>{ga4TestResult.sessions} lượt truy cập (sessions)</strong> trong 7 ngày qua ({ga4TestResult.currency}).
                      </span>
                    ) : (
                      <span>{ga4TestResult.error}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 3: ECONOMICS & RULES */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-amber-700 flex items-center gap-1.5 uppercase tracking-wide text-xs">
                  <span><AppIcon name="ads" /></span> 3. Mục tiêu Kinh tế & Quyết định AI (Economics)
                </span>
                <span className="text-xs text-slate-600">Đã điền sẵn chuẩn ngành POD / Dropship</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-900">Target CPA (USD) <span className="text-rose-700">*</span></label>
                  <input
                    type="number"
                    step="0.5"
                    value={targetCpa}
                    onChange={(e) => setTargetCpa(e.target.value)}
                    placeholder="22.0"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                  />
                  <p className="text-xs text-slate-600">Tiền ads tối đa cho 1 đơn (Mặc định: $22)</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-900">Break-even ROAS</label>
                  <input
                    type="number"
                    step="0.1"
                    value={breakEvenRoas}
                    onChange={(e) => setBreakEvenRoas(e.target.value)}
                    placeholder="2.2"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                  />
                  <p className="text-xs text-slate-600">Điểm hòa vốn để AI nhận biết ad lãi hay lỗ (Mặc định: 2.2x)</p>
                </div>
              </div>
            </div>

            {/* Collapsible Advanced JSON Toggle */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvancedJson(!showAdvancedJson)}
                className="text-xs text-slate-600 hover:text-blue-700 font-medium transition cursor-pointer flex items-center gap-1"
              >
                <span>{showAdvancedJson ? "▼" : "▶"}</span>
                <span>Chế độ nâng cao (Xem / chỉnh sửa JSON trực tiếp)</span>
              </button>

              {showAdvancedJson && (
                <div className="mt-2 space-y-2 animate-in fade-in duration-200">
                  <textarea
                    rows={8}
                    value={rawJson}
                    onChange={(e) => setRawJson(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-3 text-blue-700 font-mono text-xs focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <span><AppIcon name="warning" /></span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900 text-xs font-semibold cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-sm transition cursor-pointer flex items-center gap-1.5 ${
              saving ? "opacity-70 cursor-not-allowed" : ""
            }`}
          >
            <span>{saving ? "🔄" : "💾"}</span>
            <span>{saving ? "Đang lưu & kích hoạt…" : "Lưu & Kích hoạt ngay"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
