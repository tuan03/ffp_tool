import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  subscribeToNotifications,
  type AppNotification,
} from "../../shared/utils";

interface ToastItem extends AppNotification {
  readonly expiryTimer: number;
}

export function NotificationToastContainer(): React.JSX.Element | null {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = subscribeToNotifications((notif) => {
      const expiryTimer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== notif.id));
      }, 7000);

      setToasts((prev) => [
        ...prev.slice(-4), // Keep at most 5 toasts visible
        { ...notif, expiryTimer },
      ]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleDismiss = (id: string, timer: number) => {
    window.clearTimeout(timer);
    setToasts((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClickToast = (toast: ToastItem) => {
    if (toast.url) {
      navigate(toast.url);
      handleDismiss(toast.id, toast.expiryTimer);
    }
  };

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const typeBorder =
          toast.type === "success"
            ? "border-emerald-500/60 bg-slate-900/95 shadow-emerald-500/10"
            : toast.type === "warning"
              ? "border-amber-500/60 bg-slate-900/95 shadow-amber-500/10"
              : toast.type === "error"
                ? "border-rose-500/60 bg-slate-900/95 shadow-rose-500/10"
                : "border-cyan-500/60 bg-slate-900/95 shadow-cyan-500/10";

        const icon =
          toast.type === "success"
            ? "✅"
            : toast.type === "warning"
              ? "⚠️"
              : toast.type === "error"
                ? "❌"
                : "🔔";

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-2 ${typeBorder} ${
              toast.url ? "cursor-pointer hover:border-cyan-400" : ""
            }`}
            onClick={() => handleClickToast(toast)}
          >
            <span className="text-xl flex-shrink-0 select-none">{icon}</span>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-100 leading-tight">
                {toast.title}
              </h4>
              <p className="mt-1 text-xs text-slate-300 line-clamp-3 leading-relaxed">
                {toast.message}
              </p>
              {toast.url && (
                <p className="mt-1.5 text-[11px] font-medium text-cyan-400 hover:underline">
                  Nhấn để xem chi tiết →
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Đóng thông báo"
              onClick={(e) => {
                e.stopPropagation();
                handleDismiss(toast.id, toast.expiryTimer);
              }}
              className="text-slate-400 hover:text-slate-100 rounded p-1 transition cursor-pointer flex-shrink-0"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
