import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("Etsy workspace filters, preserves listings, replaces crawl input and isolates Amazon drafts", { skip: !uiUrl, timeout: 60000 }, async () => {
  assert.ok(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiUrl).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/shopify", async route => {
      const request = route.request().postDataJSON();
      await route.fulfill({ json: { success: true, data: request.operation === "stores.list" ? {
        stores: [{ storeId: "preaureum", shopDomain: "example.myshopify.com" }],
      } : { collections: [] } } });
    });
    await page.goto(`${uiUrl}/amazon-crawler`);
    await page.getByRole("navigation", { name: "Khu vực crawler" }).waitFor();
    assert.ok(await page.getByText(/^mock$/i).isVisible());
    const amazonInput = page.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị");
    await amazonInput.fill("B0MOCK1001");
    await page.getByLabel("Nguồn cào", { exact: true }).selectOption("etsy");
    const listingInput = page.getByLabel("URL Etsy hoặc listing ID, mỗi dòng một giá trị");
    assert.equal(await listingInput.inputValue(), "");
    const panel = page.getByRole("complementary", { name: "Kiểm tra listing Etsy" });
    await panel.getByLabel("Link Etsy hoặc listing ID", { exact: true }).fill("1876543210\n1999888777");
    await panel.getByRole("button", { name: "Kiểm tra", exact: true }).click();
    await panel.getByRole("button", { name: "Cào", exact: true }).first().waitFor();
    await listingInput.fill("1111111111\n2222222222");
    await panel.getByRole("button", { name: "Cào", exact: true }).first().click();
    assert.equal(await listingInput.inputValue(), "1876543210");
    assert.equal(await panel.getByRole("button", { name: "Cào", exact: true }).count(), 2);
    await page.getByLabel("Nguồn cào", { exact: true }).selectOption("amazon");
    assert.equal(await amazonInput.inputValue(), "B0MOCK1001");
    await page.getByLabel("Nguồn cào", { exact: true }).selectOption("etsy");
    assert.equal(await listingInput.inputValue(), "1876543210");
    assert.equal(await panel.getByRole("button", { name: "Cào", exact: true }).count(), 2);
    await page.screenshot({ path: ".runtime/etsy-ui-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: ".runtime/etsy-ui-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
