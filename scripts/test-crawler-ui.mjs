import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/')) requests.push(request.url());
  });
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/v1/clients'), { timeout: 20000 }),
    page.goto('http://127.0.0.1:3011/product-crawler'),
  ]);
  await page.waitForURL('**/amazon-crawler');
  assert.equal(response.status(), 200);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(url => new URL(url).origin === 'http://127.0.0.1:3011'));
  console.log('PASS: legacy route redirects and browser crawler API requests use client origin');
} finally {
  await browser.close();
}
