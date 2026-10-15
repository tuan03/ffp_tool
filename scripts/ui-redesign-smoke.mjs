import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:5178";
const artifactDirectory = ".cache/ui-redesign";
await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || "msedge", headless: true });
const context = await browser.newContext();
// No UI smoke check is allowed to submit a job or write to a real integration.
await context.route("**/api/**", async route => {
  if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"UI smoke check blocks writes"}' });
    return;
  }
  await route.continue();
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
const routes = ["amazon-crawler", "amazon-crawler/agent-keys", "auto-seo", "gpt-seo", "seo-review", "seo-performance", "ads-intelligence", "pinterest-pod", "review-studio", "customization", "workflow-demo", "missing-page"];
const reports = [];

try {
  await page.goto(`${baseUrl}/amazon-crawler`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.getByRole("heading", { name: "Distributed Crawler", exact: true }).waitFor();
  assert.match(await page.locator("header").first().innerText(), /mock/i, "Run this check against dev:mock only");
  const crawlInput = page.getByRole("textbox", { name: "Amazon URLs hoặc ASIN, mỗi dòng một giá trị" });
  await crawlInput.fill("B0MOCK1001");
  await page.getByRole("button", { name: "Thu gọn menu", exact: true }).click();
  assert.equal(await crawlInput.inputValue(), "B0MOCK1001", "Collapsing navigation must preserve drafts");
  assert.equal(await page.locator("aside").evaluate(element => Math.round(element.getBoundingClientRect().width)), 64);
  const queueLink = page.locator("aside").getByRole("link", { name: "SEO Queue", exact: true });
  await queueLink.focus();
  await page.waitForFunction(() => {
    const tooltip = document.querySelector('aside a[href*="/gpt-seo"] span[aria-hidden]');
    return tooltip && getComputedStyle(tooltip).opacity === "1";
  });
  assert.equal(await queueLink.locator("span[aria-hidden]").evaluate(element => getComputedStyle(element).opacity), "1");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Mở rộng menu", exact: true }).waitFor();
  await page.getByRole("button", { name: "Mở rộng menu", exact: true }).click();

  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : width === 1440 ? 900 : 1080 });
    for (const route of routes) {
      const firstError = pageErrors.length;
      await page.goto(`${baseUrl}/${route}`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.locator("#main-content").waitFor();
      const layout = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        visibleHeading: Array.from(document.querySelectorAll("h1")).some(heading => heading.getBoundingClientRect().height > 0),
      }));
      assert.equal(layout.background, "rgb(255, 255, 255)", route);
      assert.ok(layout.documentWidth <= layout.viewport + 1, `${route} overflows at ${width}px: ${layout.documentWidth}px`);
      assert.ok(layout.visibleHeading, `${route} needs a visible page heading`);
      assert.deepEqual(pageErrors.slice(firstError), [], `${route} must render without runtime errors`);
      await page.screenshot({ path: `${artifactDirectory}/${route.replaceAll("/", "-")}-${width}.png`, fullPage: width === 1440 });
      reports.push({ route, width, ...layout });
      console.log(`PASS ${width}px /${route}`);
    }
  }

  await page.goto(`${baseUrl}/amazon-crawler`, { waitUntil: "networkidle" });
  await page.route("**/api/stores/seo-profiles", route => route.fulfill({ status: 502, contentType: "application/json", body: "invalid-json" }));
  await page.getByRole("button", { name: "Thêm store", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("Không tải được danh sách SEO profile. Kiểm tra kết nối Gateway rồi thử lại.", { exact: true }).waitFor();
  await page.screenshot({ path: `${artifactDirectory}/add-store-dialog.png` });
  await page.getByRole("dialog").getByRole("button", { name: /Hủy|Đóng/ }).first().click();
  assert.equal(await page.getByRole("dialog").count(), 0);

  await page.goto(`${baseUrl}/auto-seo?storeId=capozen`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tải sản phẩm từ Shopify", exact: true }).click();
  await page.getByRole("table").waitFor();
  const productCheckbox = page.getByRole("table").getByRole("checkbox").last();
  await productCheckbox.check();
  assert.equal(await productCheckbox.isChecked(), true);
  await page.screenshot({ path: `${artifactDirectory}/auto-seo-products-selected.png` });
  await page.locator("aside").getByRole("link", { name: "SEO Review", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("storeId"), "capozen");
  await writeFile(`${artifactDirectory}/report.json`, JSON.stringify({ reports, pageErrors }, null, 2));
  console.log(`Verified ${reports.length} route/viewport combinations, sidebar persistence, draft preservation, store navigation and dialog dismissal.`);
} finally {
  await browser.close();
}
