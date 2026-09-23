/**
 * Universal Notification System for FFP Tool.
 *
 * Supports:
 * 1. Web Notification API (Desktop OS Toast notifications even when minimized)
 * 2. Web Audio API synthesized chimes (zero external audio file dependencies)
 * 3. Inactive Tab Title Flashing (draws attention when working in another tab)
 * 4. In-App Floating Toast Event Bus (reactively renders notification cards in UI)
 */

export type NotificationType = "success" | "warning" | "error" | "info";
export type SoundType = "chime" | "alert" | "none";

export interface AppNotification {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly type: NotificationType;
  readonly timestamp: number;
  readonly url?: string;
}

export interface NotifyOptions {
  readonly title: string;
  readonly message: string;
  readonly type?: NotificationType;
  readonly sound?: SoundType;
  readonly url?: string;
  readonly tag?: string;
}

export type NotificationPermissionStatus = "granted" | "denied" | "default" | "unsupported";

// In-App Notification Subscribers
type NotificationListener = (notification: AppNotification) => void;
const listeners = new Set<NotificationListener>();

let audioCtx: AudioContext | null = null;
let titleFlashingTimer: number | null = null;
let originalDocumentTitle = "";

/**
 * Safely retrieves or creates the Web Audio Context.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  try {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a pleasant synthesized notification chime or warning alert tone.
 */
export function playNotificationSound(type: SoundType = "chime"): void {
  if (type === "none") return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    if (type === "alert") {
      // 3 urgent ascending beeps for CAPTCHA or error alerts (A4 -> C#5 -> A5)
      const freqs = [440, 554.37, 880];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0.001, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.11);
      });
    } else {
      // Pleasant two-tone chime for completion (E5 -> G#5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.23);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(830.61, now + 0.12);
      gain2.gain.setValueAtTime(0.001, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.25, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.56);
    }
  } catch {
    // Audio playback error (e.g. autoplay blocked before user gesture)
  }
}

/**
 * Checks whether the browser supports the Notification API.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Returns current permission status for browser notifications.
 */
export function getNotificationPermissionStatus(): NotificationPermissionStatus {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Requests permission from the user for desktop notifications.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!isNotificationSupported()) return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    // Warm up audio context upon user permission interaction
    getAudioContext();
    return permission;
  } catch {
    return Notification.permission;
  }
}

/**
 * Flashes the browser tab title when the tab is inactive to draw user attention.
 */
export function flashTabTitle(alertText: string, durationMs = 12_000): void {
  if (typeof document === "undefined") return;
  if (!document.hidden) return;

  if (titleFlashingTimer !== null) {
    window.clearInterval(titleFlashingTimer);
    titleFlashingTimer = null;
  }

  originalDocumentTitle = originalDocumentTitle || document.title || "FFP Tool";
  let isAlertVisible = false;

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      if (titleFlashingTimer !== null) {
        window.clearInterval(titleFlashingTimer);
        titleFlashingTimer = null;
      }
      if (originalDocumentTitle) {
        document.title = originalDocumentTitle;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  titleFlashingTimer = window.setInterval(() => {
    isAlertVisible = !isAlertVisible;
    document.title = isAlertVisible ? `🔔 ${alertText}` : originalDocumentTitle;
  }, 1000);

  window.setTimeout(() => {
    if (titleFlashingTimer !== null) {
      window.clearInterval(titleFlashingTimer);
      titleFlashingTimer = null;
      if (originalDocumentTitle) {
        document.title = originalDocumentTitle;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  }, durationMs);
}

/**
 * Sends a native OS desktop notification via Web Notification API.
 */
export function sendDesktopNotification(
  title: string,
  message: string,
  options: { readonly url?: string; readonly tag?: string } = {},
): boolean {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }

  try {
    const notification = new Notification(title, {
      body: message,
      icon: "/favicon.ico",
      tag: options.tag,
    });

    notification.onclick = () => {
      window.focus();
      if (options.url) {
        window.location.href = options.url;
      }
      notification.close();
    };

    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to in-app notifications. Returns an unsubscribe function.
 */
export function subscribeToNotifications(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Main dispatch function: triggers Desktop Notification, Audio Chime,
 * Tab Title Flash, and In-App Toast across all active components.
 */
export function notifyUser(options: NotifyOptions): AppNotification {
  const {
    title,
    message,
    type = "info",
    sound = type === "error" || type === "warning" ? "alert" : "chime",
    url,
    tag,
  } = options;

  const notification: AppNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    message,
    type,
    timestamp: Date.now(),
    url,
  };

  // 1. Play synthesized audio chime
  playNotificationSound(sound);

  // 2. Trigger native OS Desktop Toast
  sendDesktopNotification(title, message, { url, tag });

  // 3. Flash browser tab title if window/tab is hidden
  flashTabTitle(title);

  // 4. Dispatch to in-app toast listeners
  listeners.forEach((listener) => {
    try {
      listener(notification);
    } catch {
      // Ignore listener error
    }
  });

  return notification;
}
