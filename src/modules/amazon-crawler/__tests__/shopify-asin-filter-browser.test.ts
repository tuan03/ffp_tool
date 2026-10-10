import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("crawler filters exact ASINs without starting jobs, preserves drafts and confirms replacement on desktop/mobile", {
  skip: !uiUrl, timeout: 60000,
}, async () => {
  assert.ok(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiUrl).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await page.route("**/api/shopify", (route) => route.fulfill({ json: { success: true, data: {
      stores: [{ storeId: "capozen", shopDomain: "capozen.example.myshopify.com" }, { storeId: "new-store", shopDomain: "new-store.myshopify.com" }], collections: [],
    } } }));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${uiUrl}/amazon-crawler`, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Khu vực crawler" }).waitFor();
    assert.ok(await page.getByText(/^mock$/i).isVisible(), "Only exercise the isolated mock UI");
    const crawlInput = page.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị");
    await crawlInput.fill("B0MOCK1001\nB0MOCK1002");
    const openButton = page.getByRole("button", { name: "Lọc ASIN trên Shopify", exact: true });
    await openButton.click();
    const dialog = page.getByRole("dialog", { name: "Lọc ASIN trên Shopify", exact: true });
    await dialog.waitFor();
    const input = dialog.getByLabel("Danh sách ASIN cần lọc", { exact: true });
    assert.equal(await input.inputValue(), "B0MOCK1001\nB0MOCK1002");
    await input.fill("b0mock1001, B0MOCK1002\nB0MOCK1001;bad");
    const checkButton = dialog.getByRole("button", { name: "Kiểm tra Shopify", exact: true });
    assert.equal(await checkButton.isDisabled(), true);
    await input.fill("b0mock1001, https://www.amazon.com/dp/B0MOCK1002\nB0MOCK1001");
    await checkButton.click();
    const missing = dialog.getByLabel("Danh sách ASIN chưa có trên Shopify", { exact: true });
    await missing.waitFor();
    assert.equal(await missing.inputValue(), "B0MOCK1002");
    assert.ok(await dialog.getByRole("region", { name: "ASIN đã có trên Shopify", exact: true }).getByText("B0MOCK1001", { exact: false }).isVisible());
    assert.equal(await crawlInput.inputValue(), "B0MOCK1001\nB0MOCK1002");
    const downloadEvent = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Tải TXT", exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "asin-chua-co-capozen.txt");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    page.once("dialog", (confirmation) => confirmation.dismiss());
    await dialog.getByRole("button", { name: "Đưa vào ô cào", exact: true }).click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await crawlInput.inputValue(), "B0MOCK1001\nB0MOCK1002");
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("button", { name: "Đưa vào ô cào", exact: true }).click();
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await crawlInput.inputValue(), "B0MOCK1002");
    assert.ok(await page.getByRole("button", { name: "Bắt đầu cào (1 link)", exact: true }).isVisible());
    await openButton.click();
    await input.fill("B0MOCK1001"); await checkButton.click();
    await missing.waitFor();
    assert.equal(await missing.inputValue(), "");
    assert.equal(await dialog.getByRole("button", { name: "Đưa vào ô cào", exact: true }).count(), 0);
    await input.fill("B0MOCK1002");
    assert.equal(await missing.count(), 0);
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await page.getByLabel("Store nhận sản phẩm", { exact: true }).selectOption("new-store");
    await openButton.click();
    assert.ok(await dialog.getByText("new-store", { exact: true }).isVisible());
    assert.equal(await missing.count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

const realUiUrl = process.env.FFP_CRAWLER_REAL_UI_TEST_URL;

test("real crawler filter fails closed on partial reads and ignores cancelled or obsolete checks", {
  skip: !realUiUrl, timeout: 60000,
}, async () => {
  assert.ok(realUiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(realUiUrl).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({
      httpCredentials: { username: process.env.FFP_CRAWLER_UI_USERNAME || "", password: process.env.FFP_CRAWLER_UI_PASSWORD || "" },
    });
    let scenario: "partial-error" | "delayed" | "empty" = "partial-error";
    let releaseResponse: (() => void) | undefined;
    let markDelayedRequest: (() => void) | undefined;
    let writeRequests = 0;
    await page.route("**/api/shopify", async (route) => {
      const request: unknown = route.request().postDataJSON();
      assert.ok(typeof request === "object" && request !== null && "operation" in request);
      if ("mode" in request && request.mode === "apply") {
        writeRequests++;
        await route.abort();
        return;
      }
      if (request.operation !== "products.metafieldPage") {
        await route.fulfill({ json: { success: true, data: {
          stores: [{ storeId: "capozen", shopDomain: "capozen.myshopify.com" }], collections: [],
        } } });
        return;
      }
      assert.ok("storeId" in request && "payload" in request && typeof request.payload === "object" && request.payload !== null);
      const isSecondPage = "after" in request.payload && request.payload.after === "second";
      if (scenario === "partial-error" && isSecondPage) {
        await route.fulfill({ status: 503, json: { success: false } });
        return;
      }
      const isDelayed = scenario === "delayed";
      if (isDelayed) await new Promise<void>((resolve) => {
        releaseResponse = resolve;
        markDelayedRequest?.();
      });
      const isPartial = scenario === "partial-error";
      try {
        await route.fulfill({ json: { success: true, storeId: request.storeId, data: {
          shopDomain: "capozen.myshopify.com", namespace: "custom", key: "amazon_asin",
          products: isPartial ? [{ id: "gid://shopify/Product/101", title: "Fixture product", status: "DRAFT", value: "B0MOCK1001" }] : [],
          pageInfo: { hasNextPage: isPartial, endCursor: isPartial ? "second" : null },
        } } });
      } catch (error: unknown) {
        // Cancelled browser requests can no longer receive their intentionally delayed fixture.
        if (!isDelayed) throw error;
      }
    });
    await page.goto(`${realUiUrl}/amazon-crawler`, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Khu vực crawler" }).waitFor();
    assert.equal(await page.getByText(/^mock$/i).count(), 0);
    await page.getByRole("button", { name: "Lọc ASIN trên Shopify", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Lọc ASIN trên Shopify", exact: true });
    const input = dialog.getByLabel("Danh sách ASIN cần lọc", { exact: true });
    const check = dialog.getByRole("button", { name: "Kiểm tra Shopify", exact: true });
    const missing = dialog.getByLabel("Danh sách ASIN chưa có trên Shopify", { exact: true });
    await input.fill("B0MOCK1001\nB0MOCK1002");
    await check.click();
    const unverified = dialog.getByLabel("Danh sách ASIN chưa xác minh", { exact: true });
    await unverified.waitFor();
    assert.equal(await unverified.inputValue(), "B0MOCK1001\nB0MOCK1002");
    assert.equal(await missing.count(), 0);

    scenario = "delayed";
    const firstDelayedRequest = new Promise<void>((resolve) => { markDelayedRequest = resolve; });
    await check.click();
    const stop = dialog.getByRole("button", { name: "Dừng kiểm tra", exact: true });
    await stop.waitFor();
    await firstDelayedRequest;
    await stop.click();
    releaseResponse?.();
    await unverified.waitFor();
    assert.equal(await missing.count(), 0);

    const secondDelayedRequest = new Promise<void>((resolve) => { markDelayedRequest = resolve; });
    await check.click();
    await stop.waitFor();
    await secondDelayedRequest;
    await input.fill("B0MOCK1003");
    releaseResponse?.();
    assert.equal(await missing.count(), 0);
    scenario = "empty";
    await check.click();
    await missing.waitFor();
    assert.equal(await missing.inputValue(), "B0MOCK1003");
    assert.equal(writeRequests, 0);
  } finally { await browser.close(); }
});
