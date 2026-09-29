import { useEffect, useMemo, useState } from "react";

import { buildAgentInstallDetails } from "../agent-install";

export interface AgentInstallModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialServerUrl?: string;
}

type CopiedValue = "command" | "download-link" | null;

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // HTTP LAN origins may expose the API but reject writes; use the legacy browser fallback below.
    }
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = value;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  document.body.appendChild(temporaryInput);
  temporaryInput.select();
  const didCopy = document.execCommand("copy");
  temporaryInput.remove();
  if (!didCopy) throw new Error("Clipboard is unavailable.");
}

export function AgentInstallModal({
  isOpen,
  onClose,
  initialServerUrl,
}: AgentInstallModalProps): React.JSX.Element | null {
  const [serverUrl, setServerUrl] = useState(() => initialServerUrl ?? window.location.origin);
  const [copiedValue, setCopiedValue] = useState<CopiedValue>(null);
  const [hasCopyError, setHasCopyError] = useState(false);
  const installState = useMemo(() => {
    try {
      return { details: buildAgentInstallDetails(serverUrl), error: null };
    } catch (error) {
      return {
        details: null,
        error: error instanceof Error ? error.message : "Địa chỉ FFP không hợp lệ.",
      };
    }
  }, [serverUrl]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleCopy(value: string, copiedType: Exclude<CopiedValue, null>): Promise<void> {
    try {
      await copyTextToClipboard(value);
      setCopiedValue(copiedType);
      setHasCopyError(false);
      window.setTimeout(() => setCopiedValue(null), 2000);
    } catch {
      setCopiedValue(null);
      setHasCopyError(true);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-install-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 id="agent-install-modal-title" className="text-lg font-bold text-slate-100">
              Kết nối máy cào Pinterest
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Sao chép link bên dưới và gửi cho người cài. Họ chỉ cần tải file BAT, mở file và chờ cài đặt hoàn tất.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hướng dẫn cài agent"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-3">
            <p className="text-sm font-semibold text-cyan-300">Cùng Wi-Fi</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Dùng IP LAN của máy chạy FFP, ví dụ <code>http://192.168.1.10:3010</code>.
            </p>
          </div>
          <div className="rounded-xl border border-violet-900/70 bg-violet-950/20 p-3">
            <p className="text-sm font-semibold text-violet-300">Khác Wi-Fi</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Dùng domain HTTPS đã deploy trên VPS, ví dụ <code>https://ffp.b6-team.site</code>.
            </p>
          </div>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-300" htmlFor="agent-server-url">
          Địa chỉ FFP mà máy nhận có thể truy cập
        </label>
        <input
          id="agent-server-url"
          type="url"
          value={serverUrl}
          onChange={(event) => {
            setServerUrl(event.target.value);
            setCopiedValue(null);
            setHasCopyError(false);
          }}
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-500"
        />

        {installState.error ? (
          <p role="alert" className="mt-2 text-xs text-rose-300">
            Địa chỉ phải là origin HTTP(S), không chứa đường dẫn, tài khoản hoặc query.
          </p>
        ) : null}

        {installState.details?.isLoopback ? (
          <div className="mt-3 rounded-lg border border-amber-700/70 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-200">
            <strong>Không gửi địa chỉ localhost này.</strong> Trên máy người nhận, localhost sẽ trỏ về chính máy của họ.
            Hãy thay bằng IP LAN khi cùng Wi-Fi hoặc domain HTTPS khi khác mạng.
          </div>
        ) : null}

        {installState.details ? (
          <>
            <div className="mt-4 rounded-xl border border-emerald-700/70 bg-emerald-950/25 p-4">
              <p className="text-sm font-bold text-emerald-300">Link gửi cho người cài</p>
              <a
                href={installState.details.batchDownloadUrl}
                download="cai-agent.bat"
                className="mt-2 block break-all rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm text-cyan-300 underline decoration-cyan-700 underline-offset-4 hover:text-cyan-200"
              >
                {installState.details.batchDownloadUrl}
              </a>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Người nhận mở link, tải <code>cai-agent.bat</code>, sau đó nhấp đúp vào file để cài và kết nối agent.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy(installState.details.batchDownloadUrl, "download-link")}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500"
              >
                {copiedValue === "download-link" ? "✓ Đã sao chép" : "Sao chép link gửi"}
              </button>
              <a
                href={installState.details.batchDownloadUrl}
                download="cai-agent.bat"
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                Tải thử file BAT
              </a>
              <button
                type="button"
                onClick={() => void handleCopy(installState.details.powershellCommand, "command")}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                {copiedValue === "command" ? "✓ Đã sao chép" : "Sao chép lệnh PowerShell"}
              </button>
            </div>
            {hasCopyError ? (
              <p role="alert" className="mt-2 text-xs text-rose-300">
                Trình duyệt không cho truy cập clipboard. Hãy bôi đen lệnh phía trên và sao chép thủ công.
              </p>
            ) : null}

            <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-400">
                Xem lệnh PowerShell thay thế
              </summary>
              <code className="mt-3 block overflow-x-auto whitespace-pre text-xs leading-5 text-cyan-300">
                {installState.details.powershellCommand}
              </code>
            </details>
          </>
        ) : null}

        <p className="mt-4 text-[11px] leading-5 text-slate-500">
          Chỉ gửi cho người bạn tin tưởng. Máy nhận sẽ tải Python dependencies, Chromium và kết nối về Coordinator của FFP.
        </p>
      </div>
    </div>
  );
}
