let busy = false;
let activeJobId = null;
let activeJobXpaths = null;
let cancelledJobs = new Set();
let visibleMessageLimit = 0;
let removeUserMessages = false;
let messageLimitObserver = null;
let messageLimitTimer = null;
const hiddenTurns = new Map();
const MAX_IMAGE_JOBS_PER_CONVERSATION = 10;
let activeImageConversationSessionId = null;
let activeImageConversationPath = null;
let activeImageConversationJobCount = 0;

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
    .catch((error) => {
      invalidateImageConversation(message.conversation_session_id);
      reportError(message.job_id, error.message || String(error));
    })
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

  if (job.kind === "image_edit" && job.conversation_mode === "session") {
    await prepareImageConversation(job.conversation_session_id, xpaths);
  } else if (job.conversation_mode === "new") {
    await openNewChat(xpaths);
  }

  const previousMessages = xpathAll(xpaths.assistant_messages);
  const previousCount = previousMessages.length;
  const previousLastText = previousMessages.at(-1)?.innerText?.trim() || "";
  const previousImageSources = new Set([...document.querySelectorAll('img')].map(img => img.currentSrc || img.src));

  let input = await waitForPromptInput(xpaths.prompt_input, 20_000);
  if (job.kind === "image_edit") {
    await attachImageReferences(
      job.images || [],
      input.closest('form') || document.querySelector('form') || document.body,
      job.job_id,
      xpaths.prompt_input
    );
    input = await waitForPromptInput(xpaths.prompt_input, 20_000);
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
    markImageConversationCompleted(job.conversation_session_id);
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

async function attachImageReferences(images, composerRoot = document, jobId = '', promptInputXPath = '') {
  if (images.length !== 2 || images[0]?.name !== "template" || images[1]?.name !== "product") {
    throw new Error("Image job requires the template first and the product second.");
  }
  for (const [imageIndex, image] of images.entries()) {
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[image.mime_type];
    if (!extension) throw new Error("Unsupported image type.");
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    const jobSuffix = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
    const fileName = jobSuffix
      ? `${image.name}-${jobSuffix}-${imageIndex + 1}.${extension}`
      : `${image.name}.${extension}`;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const activeComposer = resolveComposerRoot(composerRoot, promptInputXPath);
      const input = await findAttachmentInput(activeComposer);
      if (!input) throw new Error("ChatGPT image attachment input was not found. Reload the pinned tab.");
      const composer = input.closest('form') || activeComposer;
      const previousState = captureAttachmentState(composer);
      const file = new File([bytes], fileName, { type: image.mime_type });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      try {
        input.value = '';
      } catch {
        // Some browser-managed file inputs reject direct value assignment.
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      try {
        await waitForImageAttachment({
          composer,
          filename: file.name,
          previousState,
          input,
          promptInputXPath,
          timeoutMs: 30_000
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (/rejected|upload failed/i.test(error?.message || '')) throw error;
        await sleep(500);
      }
    }

    if (lastError) throw lastError;
  }
}

async function findAttachmentInput(composerRoot) {
  const findCurrentInput = () => {
    const scopedInput = composerRoot.querySelector('input[type="file"]');
    if (scopedInput?.isConnected !== false && !scopedInput?.disabled) return scopedInput;
    const globalInputs = [
      document.querySelector('input[type="file"]'),
      ...document.querySelectorAll('input[type="file"]')
    ].filter((candidate, index, candidates) =>
      candidate && candidates.indexOf(candidate) === index && candidate.isConnected !== false && !candidate.disabled
    );
    return globalInputs.find(candidate => candidate.closest?.('form') === composerRoot) ||
      (globalInputs.length === 1 ? globalInputs[0] : null);
  };
  let input = findCurrentInput();
  if (!input) {
    const attachButton = composerRoot.querySelector?.('[data-testid="composer-plus-btn"]') ||
      composerRoot.querySelector?.('button[aria-label*="Attach"]') ||
      composerRoot.querySelector?.('button[aria-label*="Upload"]') ||
      document.querySelector('[data-testid="composer-plus-btn"]') ||
      document.querySelector('button[aria-label*="Attach"]') ||
      document.querySelector('button[aria-label*="Upload"]');
    attachButton?.click();
    for (let attempt = 0; attempt < 40 && !input; attempt++) {
      await sleep(250);
      input = findCurrentInput();
    }
  }
  return input && input.isConnected !== false && !input.disabled ? input : null;
}

function resolveComposerRoot(preferredRoot, promptInputXPath) {
  const promptInput = findPromptInput(promptInputXPath);
  const activeComposer = promptInput?.closest('form');
  if (activeComposer && activeComposer.isConnected !== false) return activeComposer;
  if (preferredRoot && preferredRoot.isConnected !== false) return preferredRoot;
  return document.querySelector('form') || document.body || document;
}

function captureAttachmentState(composer) {
  const markers = [...composer.querySelectorAll('[data-testid*="attachment"], [data-testid*="upload"], img')];
  return {
    markerCount: markers.length,
    imageSources: new Set(
      markers
        .filter(node => node.tagName === 'IMG' || node.currentSrc || node.src)
        .map(node => node.currentSrc || node.src || '')
        .filter(Boolean)
    )
  };
}

async function waitForImageAttachment({ composer, filename, previousState, input, promptInputXPath, timeoutMs }) {
  const started = Date.now();
  let currentComposer = composer;
  let latestState = previousState;
  let isUploading = false;
  while (Date.now() - started < timeoutMs) {
    currentComposer = resolveComposerRoot(currentComposer, promptInputXPath);
    const markers = [...currentComposer.querySelectorAll('[data-testid*="attachment"], [data-testid*="upload"], [aria-label], [title], img')];
    const evidence = [currentComposer.textContent || '', ...markers.flatMap(node => [
      node.textContent || '',
      node.getAttribute?.('aria-label') || '',
      node.getAttribute?.('title') || '',
      node.getAttribute?.('alt') || ''
    ])].join(' ');
    if (/upload failed|failed to upload|could not upload|không thể tải|tải lên thất bại/i.test(evidence)) {
      throw new Error(`ChatGPT rejected ${filename}: upload failed.`);
    }
    latestState = captureAttachmentState(currentComposer);
    const hasNewImage = [...latestState.imageSources].some(source => !previousState.imageSources.has(source));
    const hasPreview = latestState.markerCount > previousState.markerCount || hasNewImage;
    isUploading = Boolean(currentComposer.querySelector('[role="progressbar"], [aria-busy="true"]'));
    if ((evidence.includes(filename) || hasPreview) && !isUploading) return;
    if (input?.isConnected === false && Date.now() - started >= 1_000) {
      throw new Error(`ChatGPT replaced the composer while attaching ${filename}.`);
    }
    await sleep(250);
  }
  throw new Error(
    `ChatGPT did not confirm attachment ${filename} after 2 attempts ` +
    `(composerConnected=${currentComposer?.isConnected !== false}, ` +
    `inputConnected=${input?.isConnected !== false}, ` +
    `markersBefore=${previousState.markerCount}, markersAfter=${latestState.markerCount}, ` +
    `uploading=${isUploading}).`
  );
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
  let stableChecks = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const promptInput = findPromptInput(xpaths.prompt_input || '');
    const composer = promptInput?.closest('form');
    const hasDraftAttachments = Boolean(
      composer?.querySelector('[data-testid*="attachment"], [data-testid*="upload"]')
    );
    const isReady =
      window.location.pathname === "/" &&
      xpathAll(xpaths.assistant_messages || "").length === 0 &&
      !hasDraftAttachments;
    stableChecks = isReady ? stableChecks + 1 : 0;
    if (stableChecks >= 4) return;
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

async function prepareImageConversation(conversationSessionId, xpaths) {
  const sessionId = String(conversationSessionId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error("Image conversation session is missing or invalid.");
  }
  if (!shouldOpenNewImageConversation(sessionId)) return;
  await openNewChat(xpaths);
  activeImageConversationSessionId = sessionId;
  activeImageConversationPath = window.location.pathname;
  activeImageConversationJobCount = 0;
}

function shouldOpenNewImageConversation(conversationSessionId) {
  if (activeImageConversationSessionId !== conversationSessionId) return true;
  if (activeImageConversationJobCount >= MAX_IMAGE_JOBS_PER_CONVERSATION) return true;
  const currentPath = window.location.pathname;
  if (activeImageConversationPath === currentPath) return false;
  if (activeImageConversationPath === '/' && currentPath !== '/') {
    activeImageConversationPath = currentPath;
    return false;
  }
  return true;
}

function markImageConversationCompleted(conversationSessionId) {
  if (!conversationSessionId || activeImageConversationSessionId !== conversationSessionId) return;
  const currentPath = window.location.pathname;
  if (currentPath !== '/' || activeImageConversationPath === '/') {
    activeImageConversationPath = currentPath;
  }
  activeImageConversationJobCount += 1;
}

function invalidateImageConversation(conversationSessionId) {
  if (conversationSessionId && activeImageConversationSessionId !== conversationSessionId) return;
  activeImageConversationSessionId = null;
  activeImageConversationPath = null;
  activeImageConversationJobCount = 0;
}

async function waitForPromptInput(xpath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const input = findPromptInput(xpath);
    if (input) return input;
    await sleep(250);
  }
  throw new Error(`ChatGPT prompt input was not found within ${timeoutMs} ms.`);
}

function findPromptInput(xpath) {
  let configuredInput = null;
  try {
    configuredInput = xpathFirst(xpath);
  } catch {
    // A stale or invalid configured XPath should not disable stable ChatGPT selectors.
  }
  if (isWritablePromptInput(configuredInput)) return configuredInput;

  const fallbackSelectors = [
    '#prompt-textarea',
    '[data-testid="composer-input"]',
    'textarea[placeholder]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"].ProseMirror'
  ];
  for (const selector of fallbackSelectors) {
    const candidates = [
      document.querySelector(selector),
      ...document.querySelectorAll(selector)
    ];
    const input = candidates.find(isWritablePromptInput);
    if (input) return input;
  }
  return null;
}

function isWritablePromptInput(element) {
  if (!(element instanceof Element) || !isVisible(element)) return false;
  const isTextArea = typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement;
  const isTextInput = typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement;
  if (isTextArea || isTextInput) {
    return !element.disabled && !element.readOnly;
  }
  return element.isContentEditable || element.getAttribute?.('contenteditable') === 'true';
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
