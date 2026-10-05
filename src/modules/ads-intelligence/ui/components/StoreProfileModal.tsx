import React, { useEffect, useState } from "react";
import type { AdsIntelligenceClient } from "../../types";

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
  const [watchlistText, setWatchlistText] = useState("");

  // JSON Raw Field
  const [rawJson, setRawJson] = useState("");

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
        if (p.competitors?.watchlist && Array.isArray(p.competitors.watchlist))
          setWatchlistText(p.competitors.watchlist.join("\n"));
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
        const watchlist = watchlistText
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        payload = {
          storeId,
          shopDomain,
          metaAccountId: metaAccountId.trim(),
          accountTimezone,
          targetCpa: Number(targetCpa) || 22,
          breakEvenRoas: Number(breakEvenRoas) || 2.2,
          ga4PropertyId: ga4PropertyId.trim() || undefined,
          watchlist,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-2xl border border-cyan-800/60 bg-slate-900 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-xl shadow-lg shadow-cyan-500/20">
              ⚙️
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Thiết lập Quảng cáo & Đo lường: <span className="text-cyan-400 font-mono">{storeId}</span>
              </h3>
              <p className="text-xs text-slate-400">
                {shopDomain ? `Shopify: ${shopDomain} · ` : ""}Chỉ cần điền ID, hệ thống tự động kết nối API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-6 text-center">Đang nạp cấu hình store…</p>
        ) : (
          <div className="space-y-5 text-xs">
            {/* SECTION 1: META ADS */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="font-bold text-cyan-300 flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                  <span>📘</span> 1. Tài khoản Meta Ads
                </span>
                <span className="text-[10px] text-slate-500">Tự động kết nối qua Meta Graph API</span>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>Meta Ad Account ID <span className="text-rose-400">*</span></span>
                  <span className="text-[10px] text-slate-400 font-normal">Dãy số hoặc act_xxxxxxxxxxxxxxx</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={metaAccountId}
                    onChange={(e) => setMetaAccountId(e.target.value)}
                    placeholder="Ví dụ: act_1569725310249145 hoặc 1569725310249145"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestMeta}
                    disabled={testingMeta || !metaAccountId.trim()}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {testingMeta ? "Đang test…" : "⚡ Test Meta"}
                  </button>
                </div>

                {metaTestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                      metaTestResult.success
                        ? "bg-emerald-950/60 border-emerald-800/70 text-emerald-300"
                        : "bg-rose-950/60 border-rose-800/70 text-rose-300"
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
                <label className="font-medium text-slate-300 text-[11px]">Múi giờ tài khoản Meta</label>
                <input
                  type="text"
                  value={accountTimezone}
                  onChange={(e) => setAccountTimezone(e.target.value)}
                  placeholder="Asia/Manila hoặc America/New_York"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* SECTION 2: GOOGLE ANALYTICS 4 (1 EMAIL DÙNG CHUNG) */}
            <div className="rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-indigo-900/40 pb-2">
                <span className="font-bold text-indigo-300 flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                  <span>📊</span> 2. Google Analytics 4 (GA4)
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">1 Email dùng chung cho tất cả store</span>
              </div>

              {/* Service Account Callout Banner */}
              <div className="p-3 rounded-lg bg-slate-950/90 border border-indigo-800/50 space-y-2">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  💡 <strong>Không cần tạo file JSON:</strong> Chỉ cần vào Google Analytics của store này (<em>Admin ➔ Property Access Management</em>), bấm <strong>Add User</strong> và thêm email sau với quyền <strong>Viewer</strong>:
                </p>
                <div className="flex items-center justify-between gap-2 bg-slate-900 p-2 rounded border border-slate-800 font-mono text-[11px] text-cyan-300">
                  <span className="truncate select-all">{GA4_SERVICE_ACCOUNT_EMAIL}</span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="shrink-0 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-[10px] font-semibold transition cursor-pointer"
                  >
                    {copiedEmail ? "✓ Đã chép" : "📋 Sao chép email"}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>GA4 Property ID (Dãy số)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Xem trong GA4 Property Settings</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ga4PropertyId}
                    onChange={(e) => setGa4PropertyId(e.target.value)}
                    placeholder="Ví dụ: 555699138"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestGa4}
                    disabled={testingGa4 || !ga4PropertyId.trim()}
                    className="px-3 py-2 rounded-lg bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {testingGa4 ? "Đang test…" : "⚡ Test GA4"}
                  </button>
                </div>

                {ga4TestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                      ga4TestResult.success
                        ? "bg-emerald-950/60 border-emerald-800/70 text-emerald-300"
                        : "bg-rose-950/60 border-rose-800/70 text-rose-300"
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
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
              <span className="font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wide text-[11px] border-b border-slate-800/80 pb-2">
                <span>🎯</span> 3. Mục tiêu Kinh tế & Quyết định AI (Economics)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-200">Target CPA (USD) <span className="text-rose-400">*</span></label>
                  <input
                    type="number"
                    step="0.5"
                    value={targetCpa}
                    onChange={(e) => setTargetCpa(e.target.value)}
                    placeholder="22.0"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-400">Chi phí tối đa chấp nhận để có 1 đơn hàng</p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-200">Break-even ROAS</label>
                  <input
                    type="number"
                    step="0.1"
                    value={breakEvenRoas}
                    onChange={(e) => setBreakEvenRoas(e.target.value)}
                    placeholder="2.2"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-400">Điểm hòa vốn để AI nhận biết ad lãi hay lỗ</p>
                </div>
              </div>

              <div className="space-y-1 pt-1">
                <label className="font-medium text-slate-300 text-[11px] flex items-center justify-between">
                  <span>Watchlist Đối thủ (Page ID / Tùy chọn)</span>
                  <span className="text-[10px] text-slate-500">Mỗi Page ID một dòng</span>
                </label>
                <textarea
                  rows={2}
                  value={watchlistText}
                  onChange={(e) => setWatchlistText(e.target.value)}
                  placeholder="100064829182341&#10;100083124589211"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Collapsible Advanced JSON Toggle */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvancedJson(!showAdvancedJson)}
                className="text-[11px] text-slate-400 hover:text-cyan-400 font-medium transition cursor-pointer flex items-center gap-1"
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
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-cyan-300 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-cyan-500/20 transition cursor-pointer flex items-center gap-1.5 ${
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
