let busy = false;
let activeJobId = null;
let activeJobXpaths = null;
let cancelledJobs = new Set();
let visibleMessageLimit = 0;
let removeUserMessages = false;
let messageLimitObserver = null;
let messageLimitTimer = null;
const hiddenTurns = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "cancel_job") {
    if (busy && (!message.job_id || message.job_id === activeJobId)) {
      cancelledJobs.add(activeJobId);
      const stopButton = activeJobXpaths?.stop_button ? xpathFirst(activeJobXpaths.stop_button) : null;
      if (stopButton && isVisible(stopButton)) stopButton.click();
    }
    sendResponse({ accepted: true });
    return false;
  }

  if (message?.type === "update_visible_message_limit") {
    visibleMessageLimit = normalizeVisibleMessageLimit(message.visibleMessageLimit);
    removeUserMessages = Boolean(message.removeUserMessages);
    applyVisibleMessageLimit();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "execute_job") return;

  if (busy) {
    // A previous bridge request may have timed out while this tab continued
    // waiting. Cancel that stale browser-side job so the next queued request
    // can recover instead of receiving busy errors forever.
    if (activeJobId) {
      cancelledJobs.add(activeJobId);
      const stopButton = activeJobXpaths?.stop_button ? xpathFirst(activeJobXpaths.stop_button) : null;
      if (stopButton && isVisible(stopButton)) stopButton.click();
    }
    reportError(message.job_id, "The extension is already processing another prompt.");
    sendResponse({ accepted: false });
    return;
  }

  busy = true;
  activeJobId = message.job_id;
  activeJobXpaths = message.xpaths || null;
  executeJob(message)
    .catch((error) => reportError(message.job_id, error.message || String(error)))
    .finally(() => {
      busy = false;
      cancelledJobs.delete(message.job_id);
      activeJobId = null;
      activeJobXpaths = null;
      applyVisibleMessageLimit({ force: true });
    });

  sendResponse({ accepted: true });
  return true;
});

async function executeJob(job) {
  if (cancelledJobs.has(job.job_id)) throw new Error("ChatGPT job cancelled.");
  visibleMessageLimit = normalizeVisibleMessageLimit(job.visibleMessageLimit);
  removeUserMessages = Boolean(job.removeUserMessages);
  applyVisibleMessageLimit({ force: true });

  const xpaths = job.xpaths;
  if (!xpaths?.prompt_input || !xpaths?.send_button || !xpaths?.assistant_messages) {
    throw new Error("XPath configuration is missing required fields.");
  }

  if (job.conversation_mode === "new") {
    await openNewChat(xpaths);
  }

  const previousMessages = xpathAll(xpaths.assistant_messages);
  const previousCount = previousMessages.length;
  const previousLastText = previousMessages.at(-1)?.innerText?.trim() || "";
  const previousImageSources = new Set([...document.querySelectorAll('img')].map(img => img.currentSrc || img.src));

  const input = await waitForXPath(xpaths.prompt_input, 20_000);
  if (job.kind === "image_edit") {
    await attachImageReferences(job.images || [], input.closest('form') || document.querySelector('form') || document.body);
  }
  input.focus();
  setPromptValue(input, job.prompt);

  await sleep(150);

  const sendButton = await waitForEnabledXPath(xpaths.send_button, 10_000, input.closest('form'));
  sendButton.click();

  if (cancelledJobs.has(job.job_id)) throw new Error("ChatGPT job cancelled.");

  if (job.kind === "image_edit") {
    const generatedImage = await waitForGeneratedImage({
      assistantMessagesXPath: xpaths.assistant_messages,
      stopButtonXPath: xpaths.stop_button,
      previousCount,
      previousImageSources,
      timeoutMs: 15 * 60_000,
      jobId: job.job_id
    });
    chrome.runtime.sendMessage({ type: "content_result", job_id: job.job_id, image: generatedImage });
    return;
  }

  const answer = await waitForAnswer({
    assistantMessagesXPath: xpaths.assistant_messages,
    stopButtonXPath: xpaths.stop_button,
    previousCount,
    previousLastText,
    timeoutMs: 10 * 60_000,
    jobId: job.job_id
  });

  chrome.runtime.sendMessage({
    type: "content_result",
    job_id: job.job_id,
    answer
  });
}

async function attachImageReferences(images, composerRoot = document) {
  if (images.length !== 2 || images[0]?.name !== "template" || images[1]?.name !== "product") {
    throw new Error("Image job requires the template first and the product second.");
  }
  for (const image of images) {
    let input = composerRoot.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
    if (!input) {
      const attachButton = document.querySelector('[data-testid="composer-plus-btn"]') ||
        document.querySelector('button[aria-label*="Attach"]') ||
        document.querySelector('button[aria-label*="Upload"]');
      attachButton?.click();
      for (let attempt = 0; attempt < 40 && !input; attempt++) {
        await sleep(250);
        input = composerRoot.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
      }
    }
    if (!input) throw new Error("ChatGPT image attachment input was not found. Reload the pinned tab.");
    const composer = input.closest('form') || composerRoot;
    const previousPreviews = composer.querySelectorAll('img').length;
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[image.mime_type];
    if (!extension) throw new Error("Unsupported image type.");
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    const file = new File([bytes], `${image.name}.${extension}`, { type: image.mime_type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForImageAttachment(composer, file.name, previousPreviews);
  }
}

async function waitForImageAttachment(composer, filename, previousPreviews) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const markers = [...composer.querySelectorAll('[data-testid*="attachment"], [aria-label], [title], img')];
    const evidence = [composer.textContent || '', ...markers.flatMap(node => [
      node.textContent || '',
      node.getAttribute?.('aria-label') || '',
      node.getAttribute?.('title') || '',
      node.getAttribute?.('alt') || ''
    ])].join(' ');
    if (/upload failed|failed to upload|could not upload|không thể tải|tải lên thất bại/i.test(evidence)) {
      throw new Error(`ChatGPT rejected ${filename}: upload failed.`);
    }
    const hasPreview = composer.querySelectorAll('img').length > previousPreviews;
    const isUploading = Boolean(composer.querySelector('[role="progressbar"], [aria-busy="true"]'));
    if ((evidence.includes(filename) || hasPreview) && !isUploading) return;
    await sleep(250);
  }
  throw new Error(`ChatGPT did not confirm attachment ${filename} within 60 seconds.`);
}

async function waitForGeneratedImage({ assistantMessagesXPath, stopButtonXPath, previousCount, previousImageSources, timeoutMs, jobId }) {
  const started = Date.now();
  let candidateSource = "";
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    if (cancelledJobs.has(jobId)) throw new Error("ChatGPT image job cancelled.");
    const messages = xpathAll(assistantMessagesXPath);
    const image = findGeneratedImage(messages, previousCount, previousImageSources);
    const source = image?.currentSrc || image?.src || "";
    if (source) {
      if (source !== candidateSource) {
        candidateSource = source;
        stableSince = Date.now();
      }
      const generating = stopButtonXPath && xpathAll(stopButtonXPath).some(isVisible);
      const turn = conversationTurnFor(messages.at(-1));
      const imageBusy = Boolean(turn?.querySelector('[aria-busy="true"], [role="progressbar"]'));
      if (!generating && !imageBusy && Date.now() - stableSince >= 3000) {
        return fetchGeneratedImage(source);
      }
    }
    await sleep(400);
  }
  throw new Error("ChatGPT did not return a generated image before timeout.");
}

function findGeneratedImage(messages, previousCount, previousImageSources) {
  const previews = [...document.querySelectorAll('[data-testid="generated-image-preview"] img, img[data-testid="generated-image-preview"]')];
  const newPreview = previews.filter(node => {
    const source = node.currentSrc || node.src || '';
    return node.complete && node.naturalWidth >= 256 && node.naturalHeight >= 256 &&
      isVisible(node) && Boolean(source) && !previousImageSources.has(source);
  }).at(-1);
  if (newPreview) return newPreview;

  const latest = messages.at(-1);
  const turn = conversationTurnFor(latest);
  if (!turn || messages.length < previousCount) return null;
  const images = [...turn.querySelectorAll('img')];
  return images.filter(node => {
    const source = node.currentSrc || node.src || '';
    return node.complete && node.naturalWidth >= 256 && node.naturalHeight >= 256 &&
      isVisible(node) && Boolean(source) && (messages.length > previousCount || !previousImageSources.has(source));
  }).at(-1) || null;
}

async function fetchGeneratedImage(source) {
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    return blobAsImagePayload(await response.blob());
  } catch (error) {
    const fallback = await chrome.runtime.sendMessage({ type: "fetch_generated_image", url: source });
    if (!fallback?.ok) throw new Error(`Could not retrieve generated image: ${fallback?.error || error.message}`);
    return fallback.image;
  }
}

async function blobAsImagePayload(blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error("Generated result is not a PNG, JPEG or WebP image.");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(new Error("Could not read generated image."));
    reader.readAsDataURL(blob);
  });
  return { mime_type: blob.type, data };
}

async function openNewChat(xpaths) {
  if (xpaths.new_chat_button) {
    const button = xpathFirst(xpaths.new_chat_button);
    if (button) {
      button.click();
      await waitForNewChatReady(xpaths);
      return;
    }
  }

  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitForNewChatReady(xpaths);
}

async function waitForNewChatReady(xpaths) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (window.location.pathname === "/" && xpathAll(xpaths.assistant_messages || "").length === 0) return;
    await sleep(250);
  }
  throw new Error("Could not confirm a new ChatGPT conversation. Product images were not uploaded.");
}

function setPromptValue(element, text) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.innerHTML = "";

    const lines = String(text).split("\n");
    lines.forEach((line, index) => {
      if (index > 0) element.appendChild(document.createElement("br"));
      element.appendChild(document.createTextNode(line));
    });

    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      })
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new Error("The prompt XPath does not point to an input or contenteditable element.");
}

async function waitForAnswer({
  assistantMessagesXPath,
  stopButtonXPath,
  previousCount,
  previousLastText,
  timeoutMs,
  jobId
}) {
  const startedAt = Date.now();
  let observedNewAnswer = false;
  let lastText = "";
  let stableSince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (cancelledJobs.has(jobId)) throw new Error("ChatGPT job cancelled.");
    const messages = xpathAll(assistantMessagesXPath);
    const candidate = messages.at(-1);
    const text = candidate?.innerText?.trim() || "";

    const isNewMessage =
      messages.length > previousCount ||
      (text && text !== previousLastText);

    if (isNewMessage && text) {
      observedNewAnswer = true;

      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      }
    }

    const stopVisible = stopButtonXPath
      ? xpathAll(stopButtonXPath).some(isVisible)
      : false;

    if (
      observedNewAnswer &&
      lastText &&
      !stopVisible &&
      Date.now() - stableSince >= 1_800
    ) {
      return lastText;
    }

    await sleep(400);
  }

  throw new Error("Timed out while waiting for ChatGPT to finish generating.");
}

async function waitForXPath(xpath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = xpathFirst(xpath);
    if (element && isVisible(element)) return element;
    await sleep(250);
  }
  throw new Error(`XPath not found within ${timeoutMs} ms: ${xpath}`);
}

async function waitForEnabledXPath(xpath, timeoutMs, composerForm = null) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const candidates = [
      ...(composerForm?.querySelectorAll('button[type="submit"]') || []),
      ...xpathAll(xpath)
    ];
    const enabledButton = candidates.find(element =>
      isVisible(element) &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true"
    );
    if (enabledButton) return enabledButton;
    await sleep(200);
  }
  throw new Error(`Send button was not enabled: ${xpath}`);
}

function xpathFirst(xpath) {
  try {
    return document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
  } catch (error) {
    throw new Error(`Invalid XPath: ${xpath}. ${error.message}`);
  }
}

function xpathAll(xpath) {
  if (!xpath) return [];

  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  const nodes = [];
  for (let i = 0; i < result.snapshotLength; i++) {
    nodes.push(result.snapshotItem(i));
  }
  return nodes;
}

function isVisible(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function normalizeVisibleMessageLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 4;
  }
  return Math.max(0, Math.min(100, Math.floor(number)));
}

function conversationTurnFor(node) {
  if (!(node instanceof Element)) {
    return null;
  }
  return (
    node.closest("[data-testid^='conversation-turn-']") ||
    node.closest("article") ||
    node.closest("[data-message-author-role]") ||
    node
  );
}

function chatMessageTurns() {
  const seen = new Set();
  const turns = [];
  for (const node of document.querySelectorAll("[data-message-author-role]")) {
    const turn = conversationTurnFor(node);
    if (!turn || seen.has(turn)) {
      continue;
    }
    seen.add(turn);
    turns.push({
      turn,
      role: node.getAttribute("data-message-author-role") || ""
    });
  }
  return turns;
}

function applyVisibleMessageLimit(options = {}) {
  if (busy && !options.force) {
    return;
  }
  for (const [turn, display] of hiddenTurns) {
    if (turn.isConnected) turn.style.display = display;
  }
  hiddenTurns.clear();
  const entries = chatMessageTurns();
  const turns = entries.filter((entry) => !(removeUserMessages && entry.role === "user"));
  const limit = normalizeVisibleMessageLimit(visibleMessageLimit);
  const keepFrom = limit > 0 ? Math.max(0, turns.length - limit) : 0;
  const hide = (turn) => {
    if (!(turn instanceof HTMLElement)) {
      return;
    }
    hiddenTurns.set(turn, turn.style.display);
    turn.style.display = "none";
  };
  if (removeUserMessages) entries.filter((entry) => entry.role === "user").forEach((entry) => hide(entry.turn));
  turns.forEach((entry, index) => { if (limit > 0 && index < keepFrom) hide(entry.turn); });
}

function scheduleVisibleMessageLimit() {
  if (busy) {
    return;
  }
  clearTimeout(messageLimitTimer);
  messageLimitTimer = setTimeout(applyVisibleMessageLimit, 150);
}

function startMessageLimitObserver() {
  if (messageLimitObserver) {
    return;
  }
  messageLimitObserver = new MutationObserver(scheduleVisibleMessageLimit);
  messageLimitObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function reportError(jobId, error) {
  chrome.runtime.sendMessage({
    type: "content_error",
    job_id: jobId,
    error
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.storage.local.get({ visibleMessageLimit: 0, removeUserMessages: false }, (settings) => {
  visibleMessageLimit = normalizeVisibleMessageLimit(settings.visibleMessageLimit);
  removeUserMessages = Boolean(settings.removeUserMessages);
  applyVisibleMessageLimit();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.visibleMessageLimit || changes.removeUserMessages)) {
    if (changes.visibleMessageLimit) {
      visibleMessageLimit = normalizeVisibleMessageLimit(changes.visibleMessageLimit.newValue);
    }
    if (changes.removeUserMessages) {
      removeUserMessages = Boolean(changes.removeUserMessages.newValue);
    }
    applyVisibleMessageLimit({ force: !busy });
  }
});

startMessageLimitObserver();
