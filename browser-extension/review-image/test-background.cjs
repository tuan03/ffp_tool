const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stored = { enabled: false, token: 'private-token', serverUrl: 'ws://127.0.0.1:9000/ws/extension' };
let onInstalled;
const chrome = {
  runtime: {
    onInstalled: { addListener(listener) { onInstalled = listener; } },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
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

vm.runInNewContext(fs.readFileSync('browser-extension/review-image/background.js', 'utf8'), {
  chrome, URL, setTimeout, clearTimeout, setInterval, clearInterval,
});

(async () => {
  await onInstalled();
  assert.equal(stored.enabled, false);
  assert.equal(stored.token, 'private-token');
  assert.equal(stored.serverUrl, 'ws://127.0.0.1:9000/ws/extension');
  assert.equal(stored.visibleMessageLimit, 0);
  assert.equal(stored.removeUserMessages, false);
  console.log('extension settings preserved on update');
})().catch(error => { console.error(error); process.exitCode = 1; });
