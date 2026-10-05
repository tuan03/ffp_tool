import React, { useEffect, useState } from "react";
import type { AdsIntelligenceClient } from "../../types";

export interface StoreProfileModalProps {
  readonly storeId: string;
  readonly shopDomain?: string;
  readonly client: AdsIntelligenceClient;
  readonly onClose: () => void;
  readonly onSaved: (storeId: string) => void;
}

export function StoreProfileModal({
  storeId,
  shopDomain,
  client,
  onClose,
  onSaved,
}: StoreProfileModalProps): React.JSX.Element {
  const [tab, setTab] = useState<"form" | "json">("form");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    name?: string;
    currency?: string;
    timezone?: string;
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

  const handleTestMeta = async () => {
    if (!metaAccountId.trim()) {
      setErrorMessage("Vui lòng nhập Meta Ad Account ID để kiểm tra.");
      return;
    }
    setTestingMeta(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      if (client.testMetaConnection) {
        const res = await client.testMetaConnection(metaAccountId.trim());
        if (res.success && res.account) {
          setTestResult({
            success: true,
            name: res.account.name,
            currency: res.account.currency,
            timezone: res.account.timezone,
          });
          if (res.account.timezone) setAccountTimezone(res.account.timezone);
        } else {
          setTestResult({ success: false, error: res.error || "Không thể kết nối" });
        }
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "Kiểm tra thất bại",
      });
    } finally {
      setTestingMeta(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        setRawJson(text);
        try {
          const parsed = JSON.parse(text);
          if (parsed.meta?.accountIds?.[0]) setMetaAccountId(parsed.meta.accountIds[0]);
          if (parsed.business?.targetCpa) setTargetCpa(String(parsed.business.targetCpa));
          if (parsed.business?.breakEvenRoas) setBreakEvenRoas(String(parsed.business.breakEvenRoas));
          if (parsed.ga4?.propertyId) setGa4PropertyId(String(parsed.ga4.propertyId));
        } catch {
          // Keep raw text even if not valid JSON yet
        }
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      if (!client.saveStoreProfile) {
        throw new Error("Client chưa hỗ trợ lưu cấu hình store.");
      }

      let payload: unknown;
      if (tab === "json") {
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
                Cấu hình Ads Profile: <span className="text-cyan-400 font-mono">{storeId}</span>
              </h3>
              <p className="text-xs text-slate-400">
                {shopDomain ? `Shopify Domain: ${shopDomain} · ` : ""}Kết nối Meta Graph API, GA4 & Mục tiêu CPA
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

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => setTab("form")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
              tab === "form" ? "bg-cyan-950/80 text-cyan-300 shadow-sm border border-cyan-800/60" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>📝</span>
            <span>Điền Form Trực Quan</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("json")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
              tab === "json" ? "bg-cyan-950/80 text-cyan-300 shadow-sm border border-cyan-800/60" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>📄</span>
            <span>Dán / Tải File JSON</span>
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-6 text-center">Đang tải cấu hình hiện tại…</p>
        ) : (
          <>
            {/* Form Mode */}
            {tab === "form" && (
              <div className="space-y-4 text-xs">
                {/* Meta Ad Account ID */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200 flex items-center justify-between">
                    <span>Meta Ad Account ID <span className="text-rose-400">*</span></span>
                    <span className="text-[11px] text-slate-400 font-normal">Định dạng act_xxxxxxxxxxxxxxx</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={metaAccountId}
                      onChange={(e) => setMetaAccountId(e.target.value)}
                      placeholder="Ví dụ: act_1569725310249145 hoặc 1569725310249145"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={handleTestMeta}
                      disabled={testingMeta || !metaAccountId.trim()}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {testingMeta ? "Đang test…" : "⚡ Test kết nối"}
                    </button>
                  </div>
                  {/* Test Connection Badge */}
                  {testResult && (
                    <div
                      className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                        testResult.success
                          ? "bg-emerald-950/60 border-emerald-800/70 text-emerald-300"
                          : "bg-rose-950/60 border-rose-800/70 text-rose-300"
                      }`}
                    >
                      <span>{testResult.success ? "✓" : "✕"}</span>
                      {testResult.success ? (
                        <span>
                          Kết nối thành công! Tài khoản: <strong>{testResult.name}</strong> ({testResult.currency} · {testResult.timezone})
                        </span>
                      ) : (
                        <span>{testResult.error}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Target CPA & Break Even ROAS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-200">
                      Target CPA (USD) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={targetCpa}
                      onChange={(e) => setTargetCpa(e.target.value)}
                      placeholder="22.0"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-slate-400">Chi phí chuyển đổi mục tiêu cho 1 đơn hàng</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-200">
                      Break-even ROAS
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={breakEvenRoas}
                      onChange={(e) => setBreakEvenRoas(e.target.value)}
                      placeholder="2.2"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-slate-400">Ngưỡng ROAS hòa vốn của sản phẩm</p>
                  </div>
                </div>

                {/* Account Timezone & GA4 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-200">Múi giờ Ad Account</label>
                    <input
                      type="text"
                      value={accountTimezone}
                      onChange={(e) => setAccountTimezone(e.target.value)}
                      placeholder="Asia/Manila hoặc America/New_York"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-200">GA4 Property ID (Tùy chọn)</label>
                    <input
                      type="text"
                      value={ga4PropertyId}
                      onChange={(e) => setGa4PropertyId(e.target.value)}
                      placeholder="Ví dụ: 555699138"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                {/* Competitor Watchlist */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200 flex items-center justify-between">
                    <span>Watchlist Đối thủ (Page ID / Tùy chọn)</span>
                    <span className="text-[10px] text-slate-400 font-normal">Mỗi Page ID một dòng</span>
                  </label>
                  <textarea
                    rows={3}
                    value={watchlistText}
                    onChange={(e) => setWatchlistText(e.target.value)}
                    placeholder="100064829182341&#10;100083124589211"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            )}

            {/* JSON Mode */}
            {tab === "json" && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200">
                    File Cấu hình Ads Profile (JSON)
                  </label>
                  <label className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold cursor-pointer">
                    <span>📁 Tải lên file .json</span>
                    <input
                      type="file"
                      accept=".json,.yaml,.yml"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <textarea
                  rows={12}
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                  placeholder={`{\n  "storeId": "${storeId}",\n  "mode": "read_only",\n  "marketCountries": ["US"],\n  "reportingCurrency": "USD",\n  "meta": {\n    "accountIds": ["act_xxxxxxxxxxxxxxx"],\n    "accountTimezone": "Asia/Manila"\n  }\n}`}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}
          </>
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
