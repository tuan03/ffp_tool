import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("paste a batch and start once without using the filter panel; skips stay visible after reload", {
  skip: !uiUrl, timeout: 60000,
}, async () => {
  assert.ok(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiUrl).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/shopify", async route => {
      const body: unknown = route.request().postDataJSON();
      const stores = typeof body === "object" && body !== null && "operation" in body && body.operation === "stores.list";
      await route.fulfill({ json: { success: true, data: stores
        ? { stores: [{ storeId: "capozen", shopDomain: "capozen.myshopify.com" }] }
        : { collections: [] } } });
    });
    await page.goto(`${uiUrl}/amazon-crawler`, { waitUntil: "domcontentloaded" });
    await page.getByText(/^mock$/i).waitFor();
    await page.getByLabel("Vendor Shopify", { exact: true }).fill("Batch Test Brand");
    await page.getByLabel("Profile cào", { exact: true }).selectOption("default");
    await page.getByLabel("Profile xử lý ảnh", { exact: true }).selectOption("default");
    await page.getByRole("button", { name: "Lưu cấu hình store", exact: true }).click();
    await page.getByText("Batch Test Brand", { exact: true }).waitFor();
    await page.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị", { exact: true }).fill("B0MOCK1001\nB0MOCK1002");
    await page.getByRole("button", { name: /^Bắt đầu cào \(2 link\)/ }).click();
    const sticky = page.getByLabel("Trạng thái phiên cào", { exact: true });
    await sticky.getByText("Đã xử lý xong danh sách", { exact: true }).waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(`Batch did not complete: ${await sticky.innerText()}; alerts: ${await page.getByRole("alert").allTextContents()}; page errors: ${errors.join("; ")}`);
    });
    assert.match(await sticky.innerText(), /2\/2 link/);
    assert.match(await sticky.innerText(), /1 đã có Shopify/);
    assert.match(await sticky.innerText(), /1\/1 sản phẩm/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sticky.getByText("Đã xử lý xong danh sách", { exact: true }).waitFor();
    assert.match(await sticky.innerText(), /1 đã có Shopify/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
