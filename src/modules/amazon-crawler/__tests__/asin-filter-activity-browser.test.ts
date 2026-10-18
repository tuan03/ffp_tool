import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("filter updates siblings, persists across batches, releases cleared work and fails closed offline", { skip: !uiUrl, timeout: 90000 }, async () => {
  assert.ok(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiUrl).hostname));
  const browser = await chromium.launch({ headless: true, channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    let active = new Set<string>();
    let shopify = new Set<string>();
    let offline = false;
    let shopifyReads = 0;
    const a = "B0CHILD001", b = "B0CHILD002", c = "B0CHILD003";
    await page.route("**/api/shopify", async (route) => {
      const { storeId } = route.request().postDataJSON();
      shopifyReads++;
      await route.fulfill({ json: { success: true, storeId, data: {
        shopDomain: `${storeId}.myshopify.com`, namespace: "custom", key: "amazon_asin",
        products: storeId === "first" ? [...shopify].map((asin, index) => ({ id: `gid://shopify/Product/${index + 1}`, title: asin, status: "ACTIVE", value: asin })) : [],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } });
    });
    await page.route("**/api/v1/asin-families/activity", async (route) => {
      if (offline) { await route.fulfill({ status: 503, json: {} }); return; }
      const { storeId, asins } = route.request().postDataJSON();
      await route.fulfill({ json: { storeId, entries: asins.map((asin: string) => ({ asin, parentAsin: "B0PARENT01", status: storeId === "first" && active.has(asin) ? "processing" : "available",
        ...(storeId === "first" && shopify.has(asin) ? { shopifyRevision: "2026-10-18T12:00:00Z" } : {}),
      })) } });
    });
    await page.goto(`${uiUrl}/src/modules/amazon-crawler/__tests__/fixtures/asin-filter.html`, { waitUntil: "domcontentloaded" });
    const input = page.getByRole("textbox", { name: "Danh sách ASIN cần lọc", exact: true });
    const check = page.getByRole("button", { name: "Kiểm tra Shopify", exact: true });
    await check.waitFor();
    await page.clock.install();
    const row = (asin: string) => page.locator(`[data-asin-row="${asin}"]`);
    const tick = async () => { await page.clock.fastForward(10_100); };
    await input.fill([a, b, c].join("\n"));
    await check.click();
    await row(b).waitFor();
    active = new Set([a, b]);
    await tick();
    await row(b).waitFor({ state: "detached" });
    assert.ok(await row(c).isVisible(), "unknown sibling stays available");
    assert.equal(shopifyReads, 1, "active polling must not rescan the Shopify catalog");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("2 đang cào/đã nhận", { exact: false }).waitFor();
    assert.equal(await row(b).count(), 0);
    await input.fill([b, c].join("\n"));
    await check.click();
    await page.getByText("1 đang cào/đã nhận", { exact: false }).waitFor();
    assert.equal(await row(b).count(), 0, "new pasted batches use server ownership");
    active.clear();
    await tick();
    await row(b).waitFor();
    assert.ok(shopifyReads >= 3, "disappearing pipeline ownership must be reconciled against Shopify");
    active.add(b);
    await tick();
    await row(b).waitFor({ state: "detached" });
    shopify.add(b); active.clear();
    await tick();
    await page.getByText("Đã có trên Shopify (1)", { exact: true }).waitFor();
    assert.equal(await row(b).count(), 0, "sync completion must not offer a duplicate crawl");
    offline = true;
    await tick();
    await page.getByText(/Chưa cập nhật được trạng thái trên server/).waitFor();
    assert.ok(await row(c).getByRole("button").isDisabled());
    assert.ok(await page.getByRole("button", { name: "Tải TXT", exact: true }).isDisabled());
    offline = false;
    await tick();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-asin-row="B0CHILD003"] button')?.disabled);
    shopify.add(c);
    await tick();
    await row(c).waitFor({ state: "detached" });
    await page.getByText("Đã có trên Shopify (2)", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Đổi store", exact: true }).click();
    assert.equal(await input.inputValue(), "");
    await input.fill(b); await check.click();
    await row(b).waitFor();
    assert.ok(await row(b).isVisible(), "ownership in another store must not block this store");
  } finally { await browser.close(); }
});
