const DEFAULT_SETTINGS = {
  enabled: true,
  serverUrl: "ws://127.0.0.1:8770/ws/extension",
  token: "change-this-token",
  visibleMessageLimit: 4,
  removeUserMessages: true
};

const serverUrlInput = document.querySelector("#serverUrl");
const tokenInput = document.querySelector("#token");
const enabledInput = document.querySelector("#enabled");
const visibleMessageLimitInput = document.querySelector("#visibleMessageLimit");
const removeUserMessagesInput = document.querySelector("#removeUserMessages");

const saveButton = document.querySelector("#save");
const pinTabButton = document.querySelector("#pinTab");
const unpinTabButton = document.querySelector("#unpinTab");

const statusElement = document.querySelector("#status");
const tabInfoElement = document.querySelector("#tabInfo");
const tabTitleElement = document.querySelector("#tabTitle");
const tabUrlElement = document.querySelector("#tabUrl");

saveButton.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim();
  const token = tokenInput.value.trim();
  const visibleMessageLimit = normalizeVisibleMessageLimit(
    visibleMessageLimitInput.value
  );

  if (!serverUrl) {
    showStatus("Bạn chưa nhập WebSocket server.", "error");
    return;
  }

  if (!token) {
    showStatus("Bạn chưa nhập Bridge token.", "error");
    return;
  }

  try {
    const parsedUrl = new URL(serverUrl);

    if (
      parsedUrl.protocol !== "ws:" &&
      parsedUrl.protocol !== "wss:"
    ) {
      throw new Error("WebSocket URL phải bắt đầu bằng ws:// hoặc wss://");
    }
  } catch (error) {
    showStatus(
      `WebSocket URL không hợp lệ: ${error.message}`,
      "error"
    );
    return;
  }

  saveButton.disabled = true;

  showStatus(
    "Đã lưu cấu hình. Extension đang kết nối lại...",
    "normal"
  );

  try {
    await chrome.storage.local.set({
      serverUrl,
      token,
      enabled: enabledInput.checked,
      visibleMessageLimit,
      removeUserMessages: removeUserMessagesInput.checked
    });

    await sleep(1200);
    await refreshStatus();
  } catch (error) {
    showStatus(
      `Không thể lưu hoặc kiểm tra kết nối: ${error.message}`,
      "error"
    );
  } finally {
    saveButton.disabled = false;
  }
});

pinTabButton.addEventListener("click", async () => {
  showStatus("Đang ghim tab ChatGPT hiện tại...", "normal");

  try {
    const response = await sendMessageWithTimeout(
      {
        type: "pin_current_chatgpt_tab"
      },
      5000
    );

    if (!response?.ok) {
      throw new Error(
        response?.error || "Không thể ghim tab ChatGPT."
      );
    }

    showStatus(
      `Đã ghim tab ChatGPT: ${response.title}`,
      "success"
    );

    await refreshStatus();
  } catch (error) {
    showStatus(error.message, "error");
  }
});

unpinTabButton.addEventListener("click", async () => {
  showStatus("Đang bỏ ghim tab ChatGPT...", "normal");

  try {
    const response = await sendMessageWithTimeout(
      {
        type: "unpin_chatgpt_tab"
      },
      5000
    );

    if (!response?.ok) {
      throw new Error(
        response?.error || "Không thể bỏ ghim tab."
      );
    }

    showStatus("Đã bỏ ghim tab ChatGPT.", "success");
    await refreshStatus();
  } catch (error) {
    showStatus(error.message, "error");
  }
});

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get(
      DEFAULT_SETTINGS
    );

    serverUrlInput.value = settings.serverUrl;
    tokenInput.value = settings.token;
    enabledInput.checked = settings.enabled;
    visibleMessageLimitInput.value = normalizeVisibleMessageLimit(
      settings.visibleMessageLimit
    );
    removeUserMessagesInput.checked = settings.removeUserMessages !== false;

    await refreshStatus();
  } catch (error) {
    showStatus(
      `Không thể đọc cấu hình extension: ${error.message}`,
      "error"
    );
  }
}

async function refreshStatus() {
  let response;

  try {
    response = await sendMessageWithTimeout(
      {
        type: "get_status"
      },
      5000
    );
  } catch (error) {
    renderPinnedTab(null);

    showStatus(
      `Không nhận được phản hồi từ background.js: ${error.message}`,
      "error"
    );

    return;
  }

  renderPinnedTab(response?.pinnedTab || null);

  const connected = Boolean(response?.connected);
  const pinned = Boolean(response?.pinnedTab);

  if (connected && pinned) {
    const userMode = response?.removeUserMessages ? "gỡ tin của bạn" : "giữ tin của bạn";
    showStatus(
      `Server: đã kết nối. Tab ChatGPT: đã ghim. Giữ ${response?.visibleMessageLimit ?? 4} tin cuối, ${userMode}.`,
      "success"
    );
    return;
  }

  if (connected && !pinned) {
    const userMode = response?.removeUserMessages ? "gỡ tin của bạn" : "giữ tin của bạn";
    showStatus(
      `Server: đã kết nối. Tab ChatGPT: chưa ghim. Giữ ${response?.visibleMessageLimit ?? 4} tin cuối, ${userMode}.`,
      "normal"
    );
    return;
  }

  showStatus(
    "Server: chưa kết nối. Kiểm tra server Python, WebSocket URL và token.",
    "error"
  );
}

function sendMessageWithTimeout(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;

      reject(
        new Error(
          `Background không phản hồi sau ${timeoutMs / 1000} giây`
        )
      );
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(
          new Error(chrome.runtime.lastError.message)
        );
        return;
      }

      resolve(response);
    });
  });
}

function renderPinnedTab(tab) {
  if (!tab) {
    tabInfoElement.classList.add("hidden");
    unpinTabButton.classList.add("hidden");

    tabTitleElement.textContent = "";
    tabUrlElement.textContent = "";

    return;
  }

  tabTitleElement.textContent = tab.title || "ChatGPT";
  tabUrlElement.textContent = tab.url || "";

  tabInfoElement.classList.remove("hidden");
  unpinTabButton.classList.remove("hidden");
}

function showStatus(message, type = "normal") {
  statusElement.textContent = message;

  statusElement.classList.remove(
    "status-success",
    "status-error"
  );

  if (type === "success") {
    statusElement.classList.add("status-success");
  }

  if (type === "error") {
    statusElement.classList.add("status-error");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeVisibleMessageLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 4;
  }
  return Math.max(0, Math.min(100, Math.floor(number)));
}

loadSettings();
