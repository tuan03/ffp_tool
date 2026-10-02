const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const uploads = [];
let unclearedUploadCount = 0;
class FakeElement {}
let acceptedNames = [];
const composer = {
  textContent: '',
  querySelectorAll() { return acceptedNames.map(name => ({ textContent: name, getAttribute() { return ''; } })); },
  querySelector() { return null; }
};
const input = {
  accept: 'image/*',
  value: 'previous-selection',
  closest() { return composer; },
  dispatchEvent(event) {
    if (event.type === 'change') {
      if (this.value !== '') unclearedUploadCount += 1;
      const files = [...this.files];
      uploads.push(files);
      this.value = files.map(file => file.name).join(',');
      setTimeout(() => acceptedNames.push(...files.map(file => file.name)), 15);
    }
  }
};
const context = {
  chrome: {
    runtime: { onMessage: { addListener() {} } },
    storage: { local: { get(_defaults, cb) { cb({ visibleMessageLimit: 4, removeUserMessages: false }); } }, onChanged: { addListener() {} } }
  },
  document: {
    documentElement: {},
    querySelectorAll() { return []; },
    querySelector(selector) { return selector === 'input[type="file"]' ? input : null; }
  },
  MutationObserver: class { observe() {} },
  File: class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } },
  DataTransfer: class { constructor() { const entries = []; this.items = { add(file) { entries.push(file); } }; this.files = entries; } },
  Event: class { constructor(type) { this.type = type; } },
  Uint8Array,
  Element: FakeElement,
  HTMLElement: FakeElement,
  window: { location: { pathname: "/c/existing" }, dispatchEvent() {} },
  history: { pushState() { context.window.location.pathname = "/"; } },
  PopStateEvent: class {},
  getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
  atob,
  setTimeout,
  clearTimeout,
  console
};
  vm.createContext(context);
vm.runInContext(fs.readFileSync('browser-extension/review-image/content.js', 'utf8'), context);
context.sleep = () => new Promise(resolve => setTimeout(resolve, 5));

(async () => {
  await context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/jpeg', data: 'Yg==' }
  ]);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0][0].name, 'template.png');
  assert.equal(uploads[1][0].name, 'product.jpg');
  assert.equal(uploads[0][0].type, 'image/png');
  assert.equal(uploads[1][0].type, 'image/jpeg');
  assert.deepEqual(acceptedNames, ['template.png', 'product.jpg']);
  const imageJob = {
    job_id: 'role-binding-test',
    prompt: 'Edit Image 1. Remove its rugs. Insert the rug from Image 2. Keep Image 2 geometry.',
    images: [
      { name: 'template', mime_type: 'image/png', data: 'YQ==' },
      { name: 'product', mime_type: 'image/jpeg', data: 'Yg==' }
    ]
  };
  const boundPrompt = context.bindImageReferencePrompt(imageJob);
  assert.match(boundPrompt, /SCENE_BACKGROUND = attachment "template-role-binding-1.png"/);
  assert.match(boundPrompt, /REPLACEMENT_PRODUCT = attachment "product-role-binding-2.jpg"/);
  assert.match(boundPrompt, /Edit SCENE_BACKGROUND/);
  assert.match(boundPrompt, /Insert the rug from REPLACEMENT_PRODUCT/);
  assert.doesNotMatch(boundPrompt, /\bImage\s*[12]\b/i);
  assert.match(boundPrompt, /regardless of the order/i);
  // ChatGPT may display the most recently uploaded attachment first.
  acceptedNames = [];
  const originalDispatchEvent = input.dispatchEvent;
  input.dispatchEvent = function(event) {
    if (event.type === 'change') {
      uploads.push([...this.files]);
      acceptedNames.unshift(...this.files.map(file => file.name));
    }
  };
  await context.attachImageReferences(imageJob.images, composer, imageJob.job_id);
  assert.deepEqual(acceptedNames, ['product-role-binding-2.jpg', 'template-role-binding-1.png']);
  assert.equal(context.bindImageReferencePrompt(imageJob), boundPrompt);
  assert.equal(uploads.at(-2)[0].parts[0][0], 97, 'scene file must contain template bytes');
  assert.equal(uploads.at(-1)[0].parts[0][0], 98, 'replacement file must contain pasted product bytes');
  input.dispatchEvent = originalDispatchEvent;
  uploads.splice(2);
  let revealed = false;
  acceptedNames = [];
  context.document.querySelector = selector => {
    if (selector === 'input[type="file"]') return revealed ? input : null;
    if (selector === '[data-testid="composer-plus-btn"]') return { click() { revealed = true; } };
    return null;
  };
  await context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/png', data: 'Yg==' }
  ]);
  assert.equal(uploads.length, 4);
  assert.deepEqual(acceptedNames, ['template.png', 'product.png']);
  acceptedNames = [];
  composer.querySelector = selector => selector === 'input[type="file"]' ? input : null;
  context.document.querySelector = () => ({ dispatchEvent() { throw new Error('wrong global upload input'); } });
  await context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/png', data: 'Yg==' }
  ], composer);
  assert.deepEqual(acceptedNames, ['template.png', 'product.png']);
  composer.textContent = 'Upload failed';
  await assert.rejects(() => context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/png', data: 'Yg==' }
  ], composer), /upload failed/i);
  composer.textContent = '';
  acceptedNames = [];
  const repeatedJobUploadStart = uploads.length;
  await context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/png', data: 'Yg==' }
  ], composer, 'first-job');
  await context.attachImageReferences([
    { name: 'template', mime_type: 'image/png', data: 'YQ==' },
    { name: 'product', mime_type: 'image/png', data: 'Yg==' }
  ], composer, 'second-job');
  assert.notEqual(
    uploads[repeatedJobUploadStart][0].name,
    uploads[repeatedJobUploadStart + 2][0].name,
    'consecutive jobs must not reuse an attachment filename'
  );
  assert.equal(unclearedUploadCount, 0, 'file input must be cleared before every upload');
  const generated = new FakeElement();
  generated.complete = true;
  generated.naturalWidth = 1024;
  generated.naturalHeight = 1024;
  generated.currentSrc = 'blob:generated';
  generated.getBoundingClientRect = () => ({ width: 500, height: 500 });
  const turn = new FakeElement();
  turn.querySelectorAll = () => [generated];
  const assistant = new FakeElement();
  assistant.closest = () => turn;
  assistant.querySelectorAll = () => [];
  assert.equal(context.findGeneratedImage([assistant], 0, new Set()), generated);
  generated.complete = false;
  assert.equal(context.findGeneratedImage([assistant], 0, new Set()), null);
  const preview = new FakeElement();
  preview.complete = true;
  preview.naturalWidth = 1312;
  preview.naturalHeight = 1199;
  preview.currentSrc = 'blob:new-review-image';
  preview.getBoundingClientRect = () => ({ width: 500, height: 450 });
  context.document.querySelectorAll = selector =>
    selector === '[data-testid="generated-image-preview"] img, img[data-testid="generated-image-preview"]'
      ? [preview]
      : [];
  assert.equal(context.findGeneratedImage([], 0, new Set()), preview);
  preview.getBoundingClientRect = () => ({ width: 0, height: 0 });
  context.document.visibilityState = 'hidden';
  assert.equal(context.findGeneratedImage([], 0, new Set()), preview, 'completed images must be detected without foreground layout');
  preview.loading = 'lazy';
  preview.complete = false;
  assert.equal(context.findGeneratedImage([], 0, new Set()), null);
  assert.equal(preview.loading, 'eager', 'result previews must load even outside the viewport');
  preview.complete = true;
  assert.equal(context.findGeneratedImage([], 0, new Set()), preview);
  assert.equal(context.findGeneratedImage([], 0, new Set([preview.currentSrc])), null, 'hidden old images are not new results');
  let clicked = false;
  context.xpathFirst = () => ({ click() { clicked = true; } });
  context.xpathAll = () => [];
  await assert.rejects(() => context.openNewChat({ new_chat_button: "//a[@href='/']", assistant_messages: "//assistant" }), /Could not confirm a new ChatGPT conversation/);
  assert.equal(clicked, true);
  context.window.location.pathname = "/";
  context.xpathAll = () => [assistant];
  await assert.rejects(() => context.openNewChat({ new_chat_button: "//a[@href='/']", assistant_messages: "//assistant" }), /Could not confirm a new ChatGPT conversation/);
  context.xpathAll = () => [];
  await context.openNewChat({ new_chat_button: "//a[@href='/']", assistant_messages: "//assistant" });
  vm.runInContext("activeImageConversationSessionId = 'batch-a'; activeImageConversationPath = '/c/batch-a'; activeImageConversationJobCount = 1", context);
  context.window.location.pathname = '/c/batch-a';
  assert.equal(context.shouldOpenNewImageConversation('batch-a'), false, 'same batch should reuse its conversation');
  assert.equal(context.shouldOpenNewImageConversation('batch-b'), true, 'a different batch must start a new conversation');
  vm.runInContext("activeImageConversationJobCount = 10", context);
  assert.equal(context.shouldOpenNewImageConversation('batch-a'), true, 'the eleventh image must rotate to a new conversation');
  vm.runInContext("activeImageConversationJobCount = 2", context);
  context.window.location.pathname = '/c/manually-selected';
  assert.equal(context.shouldOpenNewImageConversation('batch-a'), true, 'manual conversation changes must invalidate reuse');
  vm.runInContext("activeImageConversationPath = '/'", context);
  assert.equal(context.shouldOpenNewImageConversation('batch-a'), false, 'the initial ChatGPT route may settle on its conversation URL');
  assert.equal(vm.runInContext("activeImageConversationPath", context), '/c/manually-selected');
  context.invalidateImageConversation('batch-a');
  assert.equal(context.shouldOpenNewImageConversation('batch-a'), true, 'a failed job must start clean next time');
  const localizedSendButton = new FakeElement();
  localizedSendButton.disabled = false;
  localizedSendButton.getAttribute = name => name === 'aria-label' ? 'Gửi' : null;
  localizedSendButton.getBoundingClientRect = () => ({ width: 20, height: 20 });
  const promptForm = {
    querySelectorAll(selector) { return selector === 'button[type="submit"]' ? [localizedSendButton] : []; }
  };
  context.xpathFirst = () => null;
  assert.equal(await context.waitForEnabledXPath('//button[@data-testid="send-button"]', 50, promptForm), localizedSendButton);
  const currentComposerInput = new FakeElement();
  currentComposerInput.isContentEditable = true;
  currentComposerInput.getBoundingClientRect = () => ({ width: 500, height: 40 });
  context.document.querySelector = selector => selector === '#prompt-textarea' ? currentComposerInput : null;
  assert.equal(
    await context.waitForPromptInput("//div[@data-obsolete-prompt-selector='true']", 50),
    currentComposerInput
  );
  const userTurn = new FakeElement();
  userTurn.style = { display: "" };
  userTurn.isConnected = true;
  userTurn.remove = () => { throw new Error("DOM turns must not be removed"); };
  context.chatMessageTurns = () => [{ turn: userTurn, role: "user" }];
  vm.runInContext("removeUserMessages = true", context);
  context.applyVisibleMessageLimit();
  assert.equal(userTurn.style.display, "none");
  vm.runInContext("removeUserMessages = false", context);
  context.applyVisibleMessageLimit();
  assert.equal(userTurn.style.display, "");
  let pollClock = 0;
  const backgroundStopButton = new FakeElement();
  backgroundStopButton.getBoundingClientRect = () => ({ width: 0, height: 0 });
  assert.equal(context.isGenerationControlPresent(backgroundStopButton), true, 'a background generation control need not have viewport layout');
  const normalComputedStyle = context.getComputedStyle;
  context.getComputedStyle = () => ({ display: 'none', visibility: 'visible', opacity: '1' });
  assert.equal(context.isGenerationControlPresent(backgroundStopButton), false, 'a CSS-hidden progress control must not block completed images');
  context.getComputedStyle = normalComputedStyle;
  backgroundStopButton.isConnected = false;
  assert.equal(context.isGenerationControlPresent(backgroundStopButton), false);
  backgroundStopButton.isConnected = true;
  const realDate = Date;
  context.Date = class extends Date { static now() { return pollClock; } };
  context.document.querySelectorAll = selector => selector.includes('generated-image-preview') ? [preview] : [];
  context.xpathAll = xpath => xpath === '//stop' && pollClock < 4000 ? [backgroundStopButton] : [];
  context.sleep = async () => { throw new Error('image completion must not use a throttled page timer'); };
  const pollMessages = [];
  context.chrome.runtime.sendMessage = async message => {
    pollMessages.push(message);
    pollClock += message.delay_ms;
    return { ok: true };
  };
  context.fetchGeneratedImage = async () => ({ mime_type: 'image/png', data: 'Yw==' });
  const hiddenResult = await context.waitForGeneratedImage({
    assistantMessagesXPath: '//assistant', stopButtonXPath: '//stop', previousCount: 0,
    previousImageSources: new Set(), timeoutMs: 10_000, jobId: 'hidden-image-job'
  });
  assert.equal(hiddenResult.data, 'Yw==');
  assert.ok(pollClock >= 4000, 'do not return a preview while the background generation control is present');
  assert.ok(pollMessages.length > 0);
  assert.ok(pollMessages.every(message => message.type === 'wait_for_image_poll'));
  const completedPollCount = pollMessages.length;
  vm.runInContext("cancelledJobs.add('cancelled-hidden-image-job')", context);
  await assert.rejects(() => context.waitForGeneratedImage({
    assistantMessagesXPath: '//assistant', stopButtonXPath: '//stop', previousCount: 0,
    previousImageSources: new Set(), timeoutMs: 10_000, jobId: 'cancelled-hidden-image-job'
  }), /cancelled/);
  assert.equal(pollMessages.length, completedPollCount, 'cancellation must stop background polling');
  context.Date = realDate;
  context.sleep = async () => {};
  let sentPrompt = '';
  let promptWasSent = false;
  context.prepareImageConversation = async () => {};
  context.document.querySelectorAll = () => [];
  context.xpathAll = () => [];
  context.waitForPromptInput = async () => ({ focus() {}, closest() { return composer; } });
  context.attachImageReferences = async (images, _composer, jobId) => {
    assert.equal(images, imageJob.images);
    assert.equal(jobId, imageJob.job_id);
  };
  context.setPromptValue = (_input, prompt) => { sentPrompt = prompt; };
  context.waitForEnabledXPath = async () => ({ click() { promptWasSent = true; } });
  context.waitForGeneratedImage = async () => ({ mime_type: 'image/png', data: 'Yw==' });
  context.chrome.runtime.sendMessage = () => {};
  await context.executeJob({
    ...imageJob,
    kind: 'image_edit',
    conversation_mode: 'session',
    conversation_session_id: 'binding-session',
    xpaths: { prompt_input: '//input', send_button: '//send', assistant_messages: '//assistant' }
  });
  assert.equal(promptWasSent, true);
  assert.equal(sentPrompt, boundPrompt, 'the submitted ChatGPT prompt must bind to the actual attachment filenames');
  console.log('image attachment order passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
