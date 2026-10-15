import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppIcon } from "../../shared/components/AppIcon";

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
            ? "border-emerald-300 dark:border-emerald-800 bg-slate-50 dark:bg-slate-800 "
            : toast.type === "warning"
              ? "border-amber-300 dark:border-amber-800 bg-slate-50 dark:bg-slate-800 "
              : toast.type === "error"
                ? "border-rose-300 dark:border-rose-800 bg-slate-50 dark:bg-slate-800 "
                : "border-blue-300 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 ";

        const icon =
          toast.type === "success"
            ? "check"
            : toast.type === "warning"
              ? "warning"
              : toast.type === "error"
                ? "close"
                : "bell";

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-sm  transition-all animate-in slide-in-from-bottom-2 ${typeBorder} ${
              toast.url ? "cursor-pointer hover:border-blue-300 dark:hover:border-blue-800" : ""
            }`}
            onClick={() => handleClickToast(toast)}
          >
            <AppIcon name={icon} className="h-5 w-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                {toast.title}
              </h4>
              <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
                {toast.message}
              </p>
              {toast.url && (
                <p className="mt-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline">
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
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded p-1 transition cursor-pointer flex-shrink-0"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
