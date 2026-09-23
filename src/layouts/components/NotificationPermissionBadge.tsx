import { useEffect, useState } from "react";

import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  playNotificationSound,
  type NotificationPermissionStatus,
} from "../../shared/utils";

export function NotificationPermissionBadge(): React.JSX.Element | null {
  const [status, setStatus] = useState<NotificationPermissionStatus>("unsupported");
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    setStatus(getNotificationPermissionStatus());
  }, []);

  if (status === "unsupported") {
    return null;
  }

  const handleRequestOrTest = async () => {
    if (status === "default") {
      const nextStatus = await requestNotificationPermission();
      setStatus(nextStatus);
      if (nextStatus === "granted") {
        playNotificationSound("chime");
      }
    } else if (status === "granted") {
      // Play a quick test sound
      playNotificationSound("chime");
    }
  };

  if (status === "default") {
    return (
      <button
        type="button"
        onClick={handleRequestOrTest}
        title="Nhấn để cho phép nhận thông báo âm thanh và desktop khi hoàn thành tác vụ"
        className="flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-900/60 hover:text-cyan-200 cursor-pointer animate-pulse"
      >
        <span className="text-sm">🔔</span>
        <span>Bật thông báo</span>
      </button>
    );
  }

  if (status === "denied") {
    return (
      <span
        title="Thông báo máy tính bị chặn trong cài đặt trình duyệt của bạn"
        className="flex items-center gap-1.5 rounded-full border border-amber-800/40 bg-amber-950/40 px-2.5 py-0.5 text-xs text-amber-400"
      >
        <span>🔕</span>
        <span className="hidden sm:inline">Chặn thông báo</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRequestOrTest}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Thông báo đang bật. Nhấn để thử âm thanh thông báo."
      className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-0.5 text-xs text-slate-300 transition hover:border-emerald-600/60 hover:bg-slate-800 cursor-pointer"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
      <span>{isHovered ? "Thử chuông 🔔" : "Thông báo: Bật"}</span>
    </button>
  );
}
