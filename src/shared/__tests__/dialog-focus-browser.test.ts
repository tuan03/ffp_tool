import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

const uiUrl = process.env.FFP_CRAWLER_UI_TEST_URL;

test("white workspace validates drafts, keeps collection open, and restores dialog focus", {
  skip: !uiUrl, timeout: 60000,
}, async () => {
  assert.ok(uiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(uiUrl).hostname));
  const browser = await chromium.launch({ channel: process.env.FFP_CRAWLER_UI_BROWSER_CHANNEL || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => {
      if (route.request().url().endsWith("/api/shopify")) return route.fulfill({ json: { success: true, data: {
        stores: [{ storeId: "capozen", shopDomain: "capozen.example.myshopify.com" }, { storeId: "jeminise", shopDomain: "jeminise.example.myshopify.com" }],
        collections: [{ id: "collection-one", title: "Everyday rugs" }],
      } } });
      return route.fulfill({ status: 503, json: { error: "Browser QA blocks integration requests" } });
    });
    await page.goto(`${uiUrl}/amazon-crawler`);
    await page.getByText(/^mock$/i).waitFor();
    const input = page.getByLabel("Amazon URLs hoặc ASIN, mỗi dòng một giá trị");
    await input.fill("B0MOCK1001\nb0mock1001\ninvalid");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByRole("button", { name: /^Bắt đầu cào/ }).isDisabled(), true);
    await page.getByRole("button", { name: "Bỏ 1 dòng trùng", exact: true }).click();
    assert.equal(await input.inputValue(), "B0MOCK1001\ninvalid", "deduplication must not silently discard invalid input");
    await input.fill("B0MOCK1001");
    assert.equal(await input.getAttribute("aria-invalid"), "false");
    await page.getByLabel("Store nhận sản phẩm", { exact: true }).selectOption("jeminise");
    assert.equal(new URL(await page.locator('aside[aria-label="Menu chính"]').getByRole("link", { name: "SEO Queue", exact: true }).getAttribute("href") ?? "", uiUrl).searchParams.get("storeId"), "jeminise");
    await page.getByRole("checkbox", { name: "Everyday rugs", exact: true }).check();
    assert.ok(await page.getByLabel("Giá cộng thêm ($)", { exact: true }).isVisible());
    assert.equal(await page.locator("summary").filter({ hasText: "Collection, loại sản phẩm" }).count(), 0);
    const actionBar = await page.getByLabel("Thao tác phiên cào", { exact: true }).boundingBox();
    assert.ok(actionBar && actionBar.y >= 0 && actionBar.y + actionBar.height <= 901);

    const addStore = page.getByRole("button", { name: "Thêm store", exact: true });
    await addStore.click();
    const dialog = page.getByRole("dialog", { name: "Thêm & Kết nối Shopify Store mới", exact: true });
    await dialog.waitFor();
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
    await dialog.evaluate(element => {
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(control => control.getClientRects().length > 0);
      focusable.at(-1)?.focus();
    });
    await page.keyboard.press("Tab");
    assert.ok(await dialog.getByRole("button", { name: "Đóng cấu hình store", exact: true }).evaluate(button => document.activeElement === button));
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.ok(await addStore.evaluate(button => document.activeElement === button));
    assert.equal(await input.inputValue(), "B0MOCK1001");

    await page.goto(`${uiUrl}/auto-seo`);
    await page.getByRole("button", { name: "Tải sản phẩm từ Shopify", exact: true }).click();
    await page.getByRole("table").waitFor();
    await page.getByRole("table").getByRole("checkbox").last().check();
    assert.ok(await page.getByLabel("Thao tác sản phẩm đã chọn", { exact: true }).isVisible());
    await page.getByRole("table").getByRole("row").nth(1).getByRole("button", { name: /Xem/ }).first().click();
    const productDrawer = page.getByRole("dialog", { name: "Chi tiết sản phẩm (PDP)", exact: true });
    await productDrawer.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await productDrawer.isVisible(), false);

    await page.goto(`${uiUrl}/review-studio`);
    const workflowNavigation = page.getByRole("navigation", { name: "Quy trình Review Studio", exact: true });
    await workflowNavigation.getByRole("button", { name: "2. Tạo review & xuất XLSX", exact: true }).click();
    assert.equal(await page.locator("#review-studio-images").isVisible(), false);
    assert.ok(await page.locator("#review-studio-reviews").isVisible());
    await workflowNavigation.getByRole("button", { name: "1. Chuẩn bị ảnh", exact: true }).click();
    assert.ok(await page.locator("#review-studio-images").isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileMenuButton = page.getByRole("button", { name: "Mở menu điều hướng", exact: true });
    await mobileMenuButton.click();
    const mobileMenu = page.getByRole("dialog", { name: "Menu chính", exact: true });
    await mobileMenu.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await mobileMenu.isVisible(), false);
    assert.ok(await mobileMenuButton.evaluate(button => document.activeElement === button));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
