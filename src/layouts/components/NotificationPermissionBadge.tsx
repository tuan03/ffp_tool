import { useEffect, useRef, useState } from "react";

import { AppIcon } from "../../shared/components/AppIcon";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  playNotificationSound,
  isNotificationSoundMuted,
  setNotificationSoundMuted,
  type NotificationPermissionStatus,
} from "../../shared/utils";

export function NotificationPermissionBadge(): React.JSX.Element | null {
  const [status, setStatus] = useState<NotificationPermissionStatus>("unsupported");
  const [isMuted, setIsMuted] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStatus(getNotificationPermissionStatus());
    setIsMuted(isNotificationSoundMuted());
  }, []);

  // Close modal on click outside
  useEffect(() => {
    if (!isOpenModal) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setIsOpenModal(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpenModal]);

  if (status === "unsupported") {
    return null;
  }

  const handleTestSound = (type: "chime" | "alert" = "chime") => {
    playNotificationSound(type, true);
    setFeedbackMsg(type === "chime" ? "Đã phát chuông hoàn tất! 🔔" : "Đã phát chuông cảnh báo! ⚠️");
    window.setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    setNotificationSoundMuted(nextMuted);
    if (!nextMuted) {
      playNotificationSound("chime", true);
    }
  };

  const handlePrimaryClick = async () => {
    if (status === "default") {
      const nextStatus = await requestNotificationPermission();
      setStatus(nextStatus);
      if (nextStatus === "granted") {
        playNotificationSound("chime", true);
      }
    } else {
      // Toggle settings modal and play a test chime
      setIsOpenModal((prev) => !prev);
    }
  };

  return (
    <div className="relative inline-block" ref={modalRef}>
      {/* Primary Badge on Navbar */}
      {status === "default" ? (
        <button
          type="button"
          onClick={() => void handlePrimaryClick()}
          title="Nhấn để cho phép nhận thông báo âm thanh và desktop khi hoàn thành tác vụ"
          className="flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50 hover:text-blue-700 cursor-pointer animate-pulse"
        >
          <span className="text-sm"><AppIcon name="bell" /></span>
          <span>Bật thông báo</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handlePrimaryClick()}
          title="Bấm để thử âm thanh chuông hoặc cấu hình thông báo"
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition cursor-pointer ${
            isMuted
              ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-50 hover:text-slate-700"
              : "border-slate-300 bg-slate-50 text-slate-900 hover:border-blue-300 hover:bg-slate-50"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isMuted
                ? "bg-slate-200"
                : "bg-emerald-700 shadow-sm "
            }`}
          />
          <span>{isMuted ? "🔇 Chuông: Tắt" : "🔊 Chuông: Bật"}</span>
          {(status === "insecure-context" || status === "denied") && (
            <span className="text-[10px] text-amber-700 font-mono hidden sm:inline">
              (Desktop: Tắt)
            </span>
          )}
        </button>
      )}

      {/* Settings & Info Popover Modal */}
      {isOpenModal && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border border-slate-300 bg-white p-4 shadow-sm z-50 text-slate-900 animate-in fade-in slide-in-from-top-2">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-base"><AppIcon name="bell" /></span>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Cài đặt & Kiểm tra Thông báo
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpenModal(false)}
              className="text-slate-600 hover:text-slate-900 rounded p-1 text-xs"
            >
              ✕
            </button>
          </div>

          {/* Quick Sound Test Actions */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700 font-medium">Âm thanh chuông báo:</span>
              <button
                type="button"
                onClick={handleToggleMute}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                  isMuted
                    ? "bg-slate-50 text-slate-600 border border-slate-300 hover:text-slate-900"
                    : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                }`}
              >
                {isMuted ? "🔇 Đang tắt (Bấm để bật)" : "🔊 Đang bật"}
              </button>
            </div>

            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => handleTestSound("chime")}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 cursor-pointer"
              >
                <span><AppIcon name="bell" /></span>
                <span>Thử chuông hoàn tất</span>
              </button>
              <button
                type="button"
                onClick={() => handleTestSound("alert")}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 cursor-pointer"
              >
                <span><AppIcon name="warning" /></span>
                <span>Thử chuông báo động</span>
              </button>
            </div>

            {feedbackMsg && (
              <p className="text-[11px] text-center font-medium text-emerald-700 animate-in fade-in">
                {feedbackMsg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
