import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

const url = process.env.SEO_PERFORMANCE_UI_URL;
test("dashboard navigation, comparison, filters and mobile layout work in a browser", { skip: !url, timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}/seo-performance?storeId=demo`);
    const dashboard = page.getByRole("region", { name: "Dashboard Search Console" });
    await dashboard.getByRole("rowheader", { name: "sample blanket" }).waitFor();
    assert.equal(await dashboard.getByLabel("So sánh với kỳ trước").isChecked(), false);
    assert.equal(await dashboard.getByLabel("Quốc gia", { exact: true }).isVisible(), false);
    await dashboard.getByLabel("So sánh với kỳ trước").check();
    assert.ok(await dashboard.getByText("Kỳ trước:", { exact: false }).count() > 0);
    await dashboard.getByRole("button", { name: "90 ngày", exact: true }).click();
    await dashboard.getByRole("rowheader", { name: "sample blanket" }).waitFor();
    const chosenStart = await dashboard.getByLabel("Từ ngày báo cáo").inputValue();
    await page.getByRole("button", { name: "Kiểm tra website", exact: true }).first().click();
    await page.getByRole("heading", { name: "Tình trạng SEO của website" }).waitFor();
    assert.equal(await dashboard.isVisible(), false);
    await page.getByRole("button", { name: "Đề xuất cải thiện", exact: true }).click();
    await page.getByRole("button", { name: "Lịch sử thay đổi", exact: true }).click();
    await page.getByRole("button", { name: "Hiệu suất Google", exact: true }).click();
    assert.equal(await dashboard.getByLabel("Từ ngày báo cáo").inputValue(), chosenStart);
    assert.equal(await dashboard.getByLabel("So sánh với kỳ trước").isChecked(), true);
    await dashboard.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).click();
    await dashboard.getByLabel("Quốc gia", { exact: true }).fill("vnm");
    await dashboard.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await dashboard.getByText("Không có kết quả phù hợp.", { exact: false }).waitFor();
    await dashboard.getByRole("button", { name: "Xóa bộ lọc nâng cao" }).click();
    await dashboard.getByRole("rowheader", { name: "sample blanket" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
