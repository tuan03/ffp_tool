const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stored = { enabled: false, token: 'private-token', serverUrl: 'ws://127.0.0.1:9000/ws/extension' };
let onInstalled;
let onMessage;
const scheduledTimers = [];
const chrome = {
  runtime: {
    onInstalled: { addListener(listener) { onInstalled = listener; } },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { onMessage = listener; } },
  },
  storage: {
    local: {
      async get(defaults) { return defaults === null ? { ...stored } : { ...defaults, ...stored }; },
      async set(values) { Object.assign(stored, values); },
    },
    onChanged: { addListener() {} },
  },
  tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
};

let testSocket;
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; testSocket = this; }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; }
}
const context = vm.createContext({
  WebSocket: FakeSocket, console,
  chrome, URL, setTimeout(callback, delay) { scheduledTimers.push({ callback, delay }); return scheduledTimers.length; }, clearTimeout, setInterval, clearInterval,
});
vm.runInContext(fs.readFileSync('browser-extension/review-image/background.js', 'utf8'), context);

(async () => {
  await onInstalled();
  assert.equal(stored.enabled, false);
  assert.equal(stored.token, 'private-token');
  assert.equal(stored.serverUrl, 'ws://127.0.0.1:9000/ws/extension');
  assert.equal(stored.visibleMessageLimit, 0);
  assert.equal(stored.removeUserMessages, false);
  let pollResponse;
  assert.equal(onMessage({ type: 'wait_for_image_poll', delay_ms: 400 }, {}, response => { pollResponse = response; }), true);
  assert.equal(pollResponse, undefined, 'the message channel stays open until the background timer fires');
  assert.equal(scheduledTimers.at(-1).delay, 400);
  scheduledTimers.at(-1).callback();
  assert.equal(pollResponse.ok, true);
  const timerCount = scheduledTimers.length;
  onMessage({ type: 'wait_for_image_poll', delay_ms: 60_000 }, {}, response => { pollResponse = response; });
  assert.equal(pollResponse.ok, false);
  assert.equal(scheduledTimers.length, timerCount, 'unbounded worker timers must be rejected');
  Object.assign(stored, { enabled: true, serverUrl: 'wss://example.com/api/review-images/extension', token: 'extension-fixture' });
  await vm.runInContext('connectIfEnabled()', context);
  assert.equal(testSocket.url, stored.serverUrl, 'credentials must not be placed in remote URLs');
  testSocket.onopen();
  assert.equal(testSocket.sent[0].type, 'authenticate');
  assert.equal(testSocket.sent[0].token, 'extension-fixture');
  vm.runInContext('closeSocket()', context);
  console.log('extension settings preserved on update');
})().catch(error => { console.error(error); process.exitCode = 1; });
