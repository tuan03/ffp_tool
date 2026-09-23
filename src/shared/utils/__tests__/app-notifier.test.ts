import assert from "node:assert/strict";
import test from "node:test";

import {
  notifyUser,
  subscribeToNotifications,
  getNotificationPermissionStatus,
  isNotificationSupported,
  requestNotificationPermission,
  playNotificationSound,
  flashTabTitle,
  isNotificationSoundMuted,
  setNotificationSoundMuted,
  isSecureOrigin,
  type AppNotification,
} from "../app-notifier";

test("notifyUser creates a valid AppNotification object and broadcasts to subscribers", () => {
  const received: AppNotification[] = [];
  const unsubscribe = subscribeToNotifications((notif) => {
    received.push(notif);
  });

  const created = notifyUser({
    title: "Test Alert",
    message: "Background job completed",
    type: "success",
    sound: "none",
  });

  assert.equal(created.title, "Test Alert");
  assert.equal(created.message, "Background job completed");
  assert.equal(created.type, "success");
  assert.ok(created.id.startsWith("notif-"));
  assert.ok(created.timestamp > 0);

  assert.equal(received.length, 1);
  assert.equal(received[0]?.id, created.id);
  assert.equal(received[0]?.title, "Test Alert");

  unsubscribe();

  // Subsequent notifications should not be delivered to unsubscribed listener
  notifyUser({
    title: "Second Alert",
    message: "Should not be received",
    type: "info",
    sound: "none",
  });

  assert.equal(received.length, 1);
});

test("environment safety when browser APIs are absent", async () => {
  // Verifies safe execution without throwing in Node/SSR environment
  assert.equal(isNotificationSupported(), false);
  assert.equal(getNotificationPermissionStatus(), "unsupported");
  assert.equal(isSecureOrigin(), false);
  const permission = await requestNotificationPermission();
  assert.equal(permission, "unsupported");

  // Should not throw
  assert.doesNotThrow(() => {
    playNotificationSound("chime");
    playNotificationSound("alert");
    playNotificationSound("none");
    flashTabTitle("Tab Title");
  });
});

test("sound mute state toggles correctly", () => {
  assert.equal(isNotificationSoundMuted(), false);
  setNotificationSoundMuted(true);
  assert.equal(isNotificationSoundMuted(), true);
  setNotificationSoundMuted(false);
  assert.equal(isNotificationSoundMuted(), false);
});
