import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:5180";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
const artifactDirectory = ".cache/theme-smoke";
await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
const fulfillFixtures = route => route.fulfill({ status: route.request().url().endsWith("/api/shopify") ? 200 : 503, json: { success: true, data: {
  stores: [{ storeId: "capozen", shopDomain: "capozen.example.myshopify.com" }, { storeId: "jeminise", shopDomain: "jeminise.example.myshopify.com" }],
  collections: [{ id: "collection-one", title: "Everyday rugs" }],
} } });
await context.route("**/api/**", fulfillFixtures);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
const reports = [];
const routes = ["amazon-crawler", "amazon-crawler/agent-keys", "auto-seo", "gpt-seo", "seo-review", "seo-performance", "ads-intelligence", "pinterest-pod", "review-studio", "customization", "workflow-demo", "missing-page"];

async function assertTheme(theme) {
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected && getComputedStyle(document.documentElement).colorScheme === expected, theme);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), theme === "dark" ? "rgb(15, 23, 42)" : "rgb(255, 255, 255)");
  assert.equal(await page.getByRole("button", { name: theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối", exact: true }).getAttribute("aria-pressed"), String(theme === "dark"));
}

async function getContrast(locator) {
  return locator.evaluate(element => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext("2d");
    if (!paint) throw new Error("Canvas unavailable for contrast check");
    const surfaces = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) surfaces.push(getComputedStyle(ancestor).backgroundColor);
    paint.fillStyle = "white"; paint.fillRect(0, 0, 1, 1);
    for (const surface of surfaces.reverse()) { paint.fillStyle = surface; paint.fillRect(0, 0, 1, 1); }
    const background = [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3);
    paint.fillStyle = getComputedStyle(element).color; paint.fillRect(0, 0, 1, 1);
    const foreground = [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const luminance = rgb => rgb.map(channel => { const linear = channel / 255; return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const first = luminance(background), second = luminance(foreground);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
}

try {
  await page.goto(`${baseUrl}/amazon-crawler`);
  await page.getByText(/^mock$/i).waitFor();
  await assertTheme("light"); // Explicit white default, even when the OS prefers dark.
  const input = page.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị");
  const filterInput = page.getByLabel("Danh sách ASIN cần lọc", { exact: true });
  await input.fill("B0MOCK1002");
  await filterInput.fill("B0MOCK1001\nB0MOCK1002");
  await page.getByRole("checkbox", { name: "Everyday rugs", exact: true }).check();
  await page.getByLabel("Giá cộng thêm ($)", { exact: true }).fill("6.95");
  await page.getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).click();
  await assertTheme("dark");
  assert.equal(await input.inputValue(), "B0MOCK1002");
  assert.equal(await filterInput.inputValue(), "B0MOCK1001\nB0MOCK1002");
  assert.equal(await page.getByRole("checkbox", { name: "Everyday rugs", exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("Giá cộng thêm ($)", { exact: true }).inputValue(), "6.95");
  assert.ok(await getContrast(input) >= 4.5, "Dark input must remain readable");
  assert.ok(await getContrast(page.getByRole("heading", { name: "Distributed Crawler", exact: true })) >= 7);
  await page.getByRole("button", { name: "Thêm store", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Thêm & Kết nối Shopify Store mới", exact: true });
  await modal.waitFor();
  assert.ok(await getContrast(modal.locator("h3").first()) >= 7);
  assert.notEqual(await modal.locator(".max-w-xl").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
  await page.screenshot({ path: `${artifactDirectory}/crawler-store-dialog-dark.png` });
  await page.keyboard.press("Escape");
  await page.goto(`${baseUrl}/auto-seo`);
  await page.getByRole("button", { name: "Tải sản phẩm từ Shopify", exact: true }).click();
  const table = page.getByRole("table");
  await table.waitFor();
  await table.getByRole("checkbox").last().check();
  assert.ok(await getContrast(table.getByRole("columnheader").nth(2)) >= 4.5);
  await page.screenshot({ path: `${artifactDirectory}/auto-seo-loaded-dark.png` });
  await table.getByRole("button", { name: /Xem chi tiết/ }).first().click();
  const productDrawer = page.getByRole("dialog", { name: "Chi tiết sản phẩm (PDP)", exact: true });
  await productDrawer.waitFor();
  assert.ok(await getContrast(productDrawer.locator("h2").first()) >= 7);
  await page.screenshot({ path: `${artifactDirectory}/auto-seo-drawer-dark.png` });
  await page.keyboard.press("Escape");
  await page.goto(`${baseUrl}/amazon-crawler`);
  await page.reload();
  await assertTheme("dark");
  assert.equal(await input.inputValue(), "B0MOCK1002");
  const otherTab = await context.newPage();
  await otherTab.goto(`${baseUrl}/amazon-crawler`);
  await otherTab.getByRole("button", { name: "Chuyển sang chế độ sáng", exact: true }).click();
  await assertTheme("light");
  await otherTab.close();

  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole("button", { name: theme === "dark" ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng", exact: true }).click();
    }
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
      for (const route of routes) {
        const previousErrorCount = pageErrors.length;
        await page.goto(`${baseUrl}/${route}`, { waitUntil: "domcontentloaded" });
        await page.locator("#main-content h1").first().waitFor();
        await assertTheme(theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme} /${route} at ${width}px`);
        const headingContrast = await getContrast(page.locator("#main-content h1").first());
        assert.ok(headingContrast >= 4.5, `${theme} /${route} heading contrast ${headingContrast}`);
        assert.deepEqual(pageErrors.slice(previousErrorCount), []);
        if (width === 1440) await page.screenshot({ path: `${artifactDirectory}/${route.replaceAll("/", "-")}-${theme}.png` });
        reports.push({ theme, route, width, headingContrast });
        console.log(`PASS ${theme} ${width}px /${route}`);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/amazon-crawler`);
  await assertTheme("dark");
  const controlBounds = await page.getByRole("button", { name: "Chuyển sang chế độ sáng", exact: true }).boundingBox();
  assert.ok(controlBounds && controlBounds.y < 64 && controlBounds.x + controlBounds.width <= 390 && controlBounds.width >= 44);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Chuyển sang chế độ sáng", exact: true }).click();
  await assertTheme("light");
  await page.getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
  await page.keyboard.press("Enter");
  await assertTheme("dark");
  await page.screenshot({ path: `${artifactDirectory}/crawler-mobile-dark.png` });
  const limitedStorageContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await limitedStorageContext.route("**/api/**", fulfillFixtures);
  await limitedStorageContext.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage disabled", "SecurityError"); } }));
  const limitedStoragePage = await limitedStorageContext.newPage();
  await limitedStoragePage.goto(`${baseUrl}/amazon-crawler`);
  await limitedStoragePage.getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).click();
  await limitedStoragePage.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await limitedStoragePage.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(15, 23, 42)");
  await limitedStorageContext.close();
  await writeFile(`${artifactDirectory}/report.json`, JSON.stringify({ reports, pageErrors }, null, 2));
  console.log(`Verified ${reports.length} route/theme/viewport combinations, persistence, cross-tab sync, input preservation, contrast and mobile toggle.`);
} finally { await browser.close(); }
