const DEFAULT_SETTINGS = {
  enabled: true,
  serverUrl: "ws://127.0.0.1:8770/ws/extension",
  token: "change-this-token",
  chatgptTabId: null,
  visibleMessageLimit: 0,
  removeUserMessages: false
};

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;
let currentConfig = null;

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(null);
  const missing = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) => !Object.prototype.hasOwnProperty.call(saved, key))
  );
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);

  connectIfEnabled();
});

chrome.runtime.onStartup.addListener(() => {
  connectIfEnabled();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.enabled || changes.serverUrl || changes.token) {
    reconnect();
  }

  if (changes.visibleMessageLimit || changes.removeUserMessages) {
    applyVisibleMessageLimitToPinnedTab();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const saved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  if (saved.chatgptTabId === tabId) {
    await chrome.storage.local.set({
      chatgptTabId: null
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  const saved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  if (saved.chatgptTabId !== tabId) {
    return;
  }

  if (!isChatGPTUrl(tab.url)) {
    await chrome.storage.local.set({
      chatgptTabId: null
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type === "content_result") {
      sendToServer({
        type: "job_result",
        job_id: message.job_id,
        ...(message.image ? { image: message.image } : { answer: message.answer })
      });

      sendResponse({
        ok: true
      });

      return false;
    }

    if (message?.type === "fetch_generated_image") {
      fetchGeneratedImage(message.url)
        .then(image => sendResponse({ ok: true, image }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "content_error") {
      sendToServer({
        type: "job_error",
        job_id: message.job_id,
        error: message.error
      });

      sendResponse({
        ok: true
      });

      return false;
    }

    if (message?.type === "get_status") {
      getExtensionStatus()
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            connected: false,
            hasConfig: false,
            pinnedTab: null,
            error: error.message
          });
        });

      return true;
    }

    if (message?.type === "pin_current_chatgpt_tab") {
      pinCurrentChatGPTTab()
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    if (message?.type === "unpin_chatgpt_tab") {
      unpinSavedChatGPTTab()
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }

    sendResponse({
      ok: false,
      error: "Unknown message type"
    });

    return false;
  }
);

async function connectIfEnabled() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  if (!settings.enabled) {
    closeSocket();
    return;
  }

  let url;

  try {
    url = new URL(settings.serverUrl);
    url.searchParams.set("token", settings.token);
  } catch (error) {
    console.error("WebSocket URL không hợp lệ:", error);
    updateBadge(false);
    return;
  }

  closeSocket();

  try {
    socket = new WebSocket(url.toString());
  } catch (error) {
    console.error("Không thể tạo WebSocket:", error);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log("Đã kết nối ChatGPT Bridge Server");

    updateBadge(true);
    clearTimeout(reconnectTimer);
    clearInterval(keepAliveTimer);

    keepAliveTimer = setInterval(() => {
      sendToServer({
        type: "ping",
        time: Date.now()
      });
    }, 20_000);
  };

  socket.onmessage = async (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Server gửi JSON không hợp lệ:", error);
      return;
    }

    if (message.type === "hello" || message.type === "config") {
      currentConfig = message.xpaths || currentConfig;
      return;
    }

    if (message.type === "job") {
      currentConfig = message.xpaths || currentConfig;
      await dispatchJob(message);
      return;
    }

    if (message.type === "cancel") {
      await dispatchCancel(message);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateBadge(false);
  };

  socket.onclose = () => {
    console.log("WebSocket đã đóng");

    updateBadge(false);
    clearInterval(keepAliveTimer);
    scheduleReconnect();
  };
}

async function dispatchJob(job) {
  const target = await getSavedChatGPTTab();
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  if (!target?.id) {
    sendToServer({
      type: "job_error",
      job_id: job.job_id,
      error:
        "Chưa có tab ChatGPT được ghim. " +
        "Hãy mở tab ChatGPT, mở popup extension và bấm Ghim tab ChatGPT hiện tại."
    });

    return;
  }

  sendToServer({
    type: "job_started",
    job_id: job.job_id
  });

  try {
    await chrome.tabs.sendMessage(target.id, {
      type: "execute_job",
      job_id: job.job_id,
      kind: job.kind || "text",
      prompt: job.prompt,
      images: job.images,
      conversation_mode: job.conversation_mode,
      conversation_session_id: job.conversation_session_id,
      xpaths: job.xpaths || currentConfig,
      visibleMessageLimit: normalizeVisibleMessageLimit(settings.visibleMessageLimit),
      removeUserMessages: Boolean(settings.removeUserMessages)
    });
  } catch (error) {
    sendToServer({
      type: "job_error",
      job_id: job.job_id,
      error:
        `Không gửi được prompt đến tab ChatGPT đã ghim: ${error.message}. ` +
        "Hãy reload tab ChatGPT rồi thử lại."
    });
  }
}

async function fetchGeneratedImage(url) {
  const parsed = new URL(url);
  const allowed = parsed.protocol === "https:" && (
    parsed.hostname === "chatgpt.com" ||
    parsed.hostname.endsWith(".chatgpt.com") ||
    parsed.hostname.endsWith(".oaiusercontent.com") ||
    parsed.hostname.endsWith(".openai.com")
  );
  if (!allowed) throw new Error("Generated image URL is not from ChatGPT.");
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Image download failed (${response.status})`);
  const blob = await response.blob();
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("Unsupported generated image format.");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Could not read generated image."));
    reader.readAsDataURL(blob);
  });
  return { mime_type: blob.type, data };
}

async function dispatchCancel(message) {
  const target = await getSavedChatGPTTab();
  if (!target?.id) return;
  try {
    await chrome.tabs.sendMessage(target.id, {
      type: "cancel_job",
      job_id: message.job_id
    });
  } catch (error) {
    console.warn("Could not cancel ChatGPT job:", error);
  }
}

async function applyVisibleMessageLimitToPinnedTab() {
  const target = await getSavedChatGPTTab();
  if (!target?.id) {
    return;
  }
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  try {
    await chrome.tabs.sendMessage(target.id, {
      type: "update_visible_message_limit",
      visibleMessageLimit: normalizeVisibleMessageLimit(settings.visibleMessageLimit),
      removeUserMessages: Boolean(settings.removeUserMessages)
    });
  } catch {
    // Content script may not be ready until the ChatGPT tab is reloaded.
  }
}

async function getSavedChatGPTTab() {
  const saved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  if (saved.chatgptTabId === null) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(saved.chatgptTabId);

    if (!tab?.id || !isChatGPTUrl(tab.url)) {
      await chrome.storage.local.set({
        chatgptTabId: null
      });

      return null;
    }

    if (!tab.pinned) {
      await chrome.tabs.update(tab.id, {
        pinned: true
      });
    }

    return tab;
  } catch (error) {
    await chrome.storage.local.set({
      chatgptTabId: null
    });

    return null;
  }
}

async function pinCurrentChatGPTTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (!tab?.id) {
    throw new Error("Không tìm thấy tab hiện tại.");
  }

  if (!isChatGPTUrl(tab.url)) {
    throw new Error(
      "Tab hiện tại không phải ChatGPT. " +
      "Hãy mở https://chatgpt.com rồi bấm lại nút ghim."
    );
  }

  const oldSaved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  if (
    oldSaved.chatgptTabId !== null &&
    oldSaved.chatgptTabId !== tab.id
  ) {
    try {
      await chrome.tabs.update(oldSaved.chatgptTabId, {
        pinned: false
      });
    } catch {
      // Tab cũ có thể đã bị đóng.
    }
  }

  const updatedTab = await chrome.tabs.update(tab.id, {
    pinned: true
  });

  await chrome.storage.local.set({
    chatgptTabId: tab.id
  });

  return {
    ok: true,
    tabId: tab.id,
    title: updatedTab.title || tab.title || "ChatGPT",
    url: updatedTab.url || tab.url
  };
}

async function unpinSavedChatGPTTab() {
  const saved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  if (saved.chatgptTabId !== null) {
    try {
      await chrome.tabs.update(saved.chatgptTabId, {
        pinned: false
      });
    } catch {
      // Tab có thể đã bị đóng.
    }
  }

  await chrome.storage.local.set({
    chatgptTabId: null
  });

  return {
    ok: true
  };
}

async function getExtensionStatus() {
  const saved = await chrome.storage.local.get({
    chatgptTabId: null
  });

  let pinnedTab = null;

  if (saved.chatgptTabId !== null) {
    try {
      const tab = await chrome.tabs.get(saved.chatgptTabId);

      if (tab?.id && isChatGPTUrl(tab.url)) {
        pinnedTab = {
          id: tab.id,
          title: tab.title || "ChatGPT",
          url: tab.url,
          pinned: Boolean(tab.pinned)
        };
      } else {
        await chrome.storage.local.set({
          chatgptTabId: null
        });
      }
    } catch {
      await chrome.storage.local.set({
        chatgptTabId: null
      });
    }
  }

  return {
    connected: socket?.readyState === WebSocket.OPEN,
    hasConfig: Boolean(currentConfig),
    pinnedTab,
    visibleMessageLimit: normalizeVisibleMessageLimit((await chrome.storage.local.get(DEFAULT_SETTINGS)).visibleMessageLimit),
    removeUserMessages: Boolean((await chrome.storage.local.get(DEFAULT_SETTINGS)).removeUserMessages)
  };
}

function normalizeVisibleMessageLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 4;
  }
  return Math.max(0, Math.min(100, Math.floor(number)));
}

function sendToServer(payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket chưa kết nối. Không thể gửi:", payload);
    return false;
  }

  socket.send(JSON.stringify(payload));
  return true;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    connectIfEnabled();
  }, 3_000);
}

function closeSocket() {
  clearTimeout(reconnectTimer);
  clearInterval(keepAliveTimer);

  reconnectTimer = null;
  keepAliveTimer = null;

  if (socket) {
    socket.onclose = null;

    try {
      socket.close();
    } catch {
      // Bỏ qua lỗi khi socket đã đóng.
    }

    socket = null;
  }

  updateBadge(false);
}

function reconnect() {
  closeSocket();
  connectIfEnabled();
}

function updateBadge(connected) {
  chrome.action.setBadgeText({
    text: connected ? "ON" : ""
  });

  chrome.action.setBadgeBackgroundColor({
    color: "#188038"
  });
}

function isChatGPTUrl(url) {
  if (typeof url !== "string") {
    return false;
  }

  try {
    const parsedUrl = new URL(url);

    return (
      parsedUrl.protocol === "https:" &&
      (
        parsedUrl.hostname === "chatgpt.com" ||
        parsedUrl.hostname.endsWith(".chatgpt.com")
      )
    );
  } catch {
    return false;
  }
}

connectIfEnabled();
