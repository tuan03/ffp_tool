const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const uploads = [];
class FakeElement {}
let acceptedNames = [];
const composer = {
  textContent: '',
  querySelectorAll() { return acceptedNames.map(name => ({ textContent: name, getAttribute() { return ''; } })); },
  querySelector() { return null; }
};
const input = {
  accept: 'image/*',
  closest() { return composer; },
  dispatchEvent(event) {
    if (event.type === 'change') {
      const files = [...this.files];
      uploads.push(files);
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
  console.log('image attachment order passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
