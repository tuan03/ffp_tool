import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("crawler workspace preserves drafts, isolates maintenance, and opens accessible details on desktop and mobile", {
  skip: !uiUrl,
  timeout: 60000,
}, async () => {
  assert.ok(uiUrl);
  const origin = new URL(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname), "Browser QA must use an isolated local mock server");
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/shopify", (route) => {
      const body: unknown = route.request().postDataJSON();
      const isStoresRequest = typeof body === "object" && body !== null && "operation" in body && body.operation === "stores.list";
      return route.fulfill({ json: { success: true, data: isStoresRequest ? {
        stores: [
          { storeId: "capozen", shopDomain: "capozen.example.myshopify.com" },
          { storeId: "jeminise", shopDomain: "jeminise.example.myshopify.com" },
        ],
      } : {
        collections: [
          { id: "collection-one", title: "Collection One With A Long Name For Everyday Product Selection", productsCount: 1 },
          { id: "collection-two", title: "Collection Two", productsCount: 1 },
        ],
      } } });
    });
    await page.goto(`${uiUrl}/amazon-crawler`, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Khu vực crawler" }).waitFor();
    assert.ok(await page.getByText(/^mock$/i).isVisible(), "Do not exercise a production crawler in browser QA");
    const navigation = page.getByRole("navigation", { name: "Khu vực crawler" });
    const crawl = page.locator("#crawler-panel-crawl");
    const asinInput = crawl.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị");
    await asinInput.fill("B0MOCK1001\nB0MOCK1002");
    await crawl.getByLabel("Profile cào", { exact: true }).selectOption("preaurem");
    const settingsToggle = crawl.locator("summary").filter({ hasText: "Collection, loại sản phẩm" });
    assert.equal(await settingsToggle.locator("..").getAttribute("open"), "");
    assert.equal(await crawl.getByLabel("Store nhận sản phẩm", { exact: true }).count(), 1);
    const settingsBounds = await settingsToggle.locator("..").boundingBox();
    const formBounds = await crawl.getByRole("region", { name: "Tạo phiên cào", exact: true }).boundingBox();
    assert.ok(settingsBounds && formBounds && settingsBounds.width > formBounds.width * 0.9);
    const collectionSearch = crawl.getByRole("searchbox", { name: "Tìm collection", exact: true });
    const firstCollection = crawl.getByRole("checkbox", { name: "Collection One With A Long Name For Everyday Product Selection", exact: true });
    await firstCollection.check();
    await collectionSearch.fill("TWO");
    assert.equal(await firstCollection.count(), 0);
    await crawl.getByRole("checkbox", { name: "Collection Two", exact: true }).check();
    assert.ok(await crawl.getByRole("button", { name: "Bỏ collection Collection One With A Long Name For Everyday Product Selection", exact: true }).isVisible());
    await collectionSearch.fill("no matches");
    assert.ok(await crawl.getByText("Không tìm thấy collection phù hợp.", { exact: true }).isVisible());
    await collectionSearch.fill("");
    assert.equal(await firstCollection.isChecked(), true);
    await crawl.getByLabel("Giá cộng thêm ($)", { exact: true }).fill("6.95");
    await navigation.getByRole("button", { name: "Agent", exact: true }).click();
    assert.equal(await asinInput.isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "Xóa toàn bộ cache", exact: true }).isVisible(), false);
    await navigation.getByRole("button", { name: "Chẩn đoán & bảo trì", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Xóa toàn bộ cache", exact: true }).isVisible(), true);
    await navigation.getByRole("button", { name: "Cào sản phẩm", exact: true }).click();
    assert.equal(await asinInput.inputValue(), "B0MOCK1001\nB0MOCK1002");
    assert.equal(await crawl.getByLabel("Profile cào", { exact: true }).inputValue(), "preaurem");
    assert.equal(await crawl.getByLabel("Giá cộng thêm ($)", { exact: true }).inputValue(), "6.95");
    assert.equal(await firstCollection.isChecked(), true);
    assert.equal(await crawl.getByRole("checkbox", { name: "Collection Two", exact: true }).isChecked(), true);
    await settingsToggle.click();
    await settingsToggle.click();
    assert.equal(await firstCollection.isChecked(), true);
    assert.equal(await crawl.getByLabel("Giá cộng thêm ($)", { exact: true }).inputValue(), "6.95");

    const imageButton = crawl.getByRole("button", { name: "Cấu hình ảnh", exact: true });
    await imageButton.click();
    const imageDialog = page.getByRole("dialog", { name: "Cấu hình xử lý ảnh" });
    await imageDialog.waitFor();
    await imageDialog.getByLabel("Tên", { exact: true }).fill("Unsaved image draft");
    await page.keyboard.press("Escape");
    assert.equal(await imageDialog.isVisible(), false);
    assert.ok(await imageButton.evaluate((button) => document.activeElement === button));
    await imageButton.click();
    assert.equal(await imageDialog.getByLabel("Tên", { exact: true }).inputValue(), "Unsaved image draft");
    await imageDialog.getByRole("button", { name: "Đóng", exact: true }).click();

    await crawl.getByRole("button").filter({ hasText: "Amazon Ceramic Mug" }).click();
    const productDialog = page.getByRole("dialog", { name: "Chi tiết sản phẩm đã cào" });
    await productDialog.waitFor();
    assert.ok(await productDialog.getByText("Xử lý ảnh", { exact: true }).isVisible());
    await productDialog.getByRole("button", { name: "Source variants", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await productDialog.isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await settingsToggle.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await settingsToggle.click();
    await imageButton.click();
    assert.ok(await imageDialog.evaluate((dialog) => dialog.getBoundingClientRect().right <= innerWidth));
    await imageDialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Khu vực crawler" }).waitFor();
    assert.equal(await settingsToggle.locator("..").getAttribute("open"), "");
    await firstCollection.waitFor();
    assert.equal(await firstCollection.isChecked(), true);
    await crawl.getByRole("button", { name: "Bỏ chọn hết", exact: true }).click();
    assert.equal(await firstCollection.isChecked(), false);
    await crawl.getByRole("button", { name: "Chọn tất cả (2)", exact: true }).click();
    assert.equal(await firstCollection.isChecked(), true);
    await collectionSearch.fill("TWO");
    await crawl.getByLabel("Store nhận sản phẩm", { exact: true }).selectOption("jeminise");
    assert.equal(await collectionSearch.inputValue(), "");
    await firstCollection.waitFor();
    assert.equal(await firstCollection.isChecked(), false);
    assert.equal(await asinInput.inputValue(), "B0MOCK1001\nB0MOCK1002");
    assert.equal(await crawl.getByLabel("Profile cào", { exact: true }).inputValue(), "preaurem");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
