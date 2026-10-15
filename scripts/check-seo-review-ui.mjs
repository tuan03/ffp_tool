// Isolated browser QA. All API traffic is fulfilled locally; no Shopify writes or credentials.
// Build production assets, start Vite preview, then run: node scripts/check-seo-review-ui.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.SEO_REVIEW_PREVIEW_URL ?? "http://127.0.0.1:5182";
const artifacts = ".cache/seo-review-ui";
const titles = ["Personalized Vinyl Record Round Rug", "Forest Bear Entryway Doormat", "Botanical Studio Rug", "Minimal Line Art Mat", "Music Room Area Rug"];
const statuses = ["synced", "syncing", "failed", "idle", "synced"];
const summaries = titles.map((title, index) => ({ id: `fixture-${index}`, recordId: `preview-store:fixture-${index}`,
  productId: `fixture-${index}`, storeId: "preview-store", source: "auto_seo", title, handle: `studio-rug-${index}`,
  thumbnailUrl: "https://fixture.invalid/rug.svg", decision: index === 3 ? "pending" : "approved", syncStatus: statuses[index],
  syncError: index === 2 ? "SHOPIFY_PUBLICATION_INCOMPLETE: Nội dung đã lưu, kênh bán hàng chưa đầy đủ." : undefined,
  updatedAt: 1_700_000_000_000 - index }));
const counts = { pending: 1, ready: 0, failed: 1, syncing: 1, history: 2, synced: 2 };
const emptyPage = { items: [], total: 0, nextOffset: null, counts: { pending: 0, ready: 0, failed: 0, syncing: 0, history: 0, synced: 0 } };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let blockedWrites = 0;
  let listShouldFail = false;
  const queries = [];
  await context.route("https://fixture.invalid/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="40" fill="#475569"/><circle cx="50" cy="50" r="13" fill="#e2c8aa"/></svg>' }));
  await context.route("**/api/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = json => route.fulfill({ status: 200, json });
    if (url.pathname === "/api/shopify" && request.postDataJSON()?.operation === "stores.list") return respond({ success: true,
      data: { stores: [{ storeId: "preview-store", shopDomain: "preview.example.myshopify.com" }, { storeId: "empty-store", shopDomain: "empty.example.myshopify.com" }] } });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      blockedWrites++;
      return route.fulfill({ status: 503, json: { error: "Browser QA blocks all business writes" } });
    }
    if (url.pathname === "/api/seo-review/items") {
      queries.push(url.search);
      if (listShouldFail) return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } });
      if (url.searchParams.get("storeId") === "empty-store") return respond(emptyPage);
      const workspace = url.searchParams.get("workspace");
      const stage = url.searchParams.get("stage");
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const items = summaries.filter(row => (!search || row.title.toLowerCase().includes(search)) &&
        (workspace === "synced" ? row.syncStatus === "synced" : workspace === "work" ? row.syncStatus !== "synced" : true) &&
        (stage === "failed" ? row.syncStatus === "failed" : stage === "syncing" ? row.syncStatus === "syncing" : true));
      return respond({ items, total: items.length, nextOffset: null, counts });
    }
    if (url.pathname.startsWith("/api/seo-review/items/")) {
      const recordId = decodeURIComponent(url.pathname.split("/").at(-1));
      const summary = summaries.find(row => row.recordId === recordId);
      assert.ok(summary);
      return respond({ item: { itemId: summary.recordId, storeId: summary.storeId, productId: summary.productId,
        reviewStatus: summary.decision, sourceOrigin: "auto_seo", backupId: `backup-${summary.id}`, shopifyUpdatedAt: "2026-10-15T01:00:00Z", notes: null, updatedAt: "2026-10-15T01:00:00Z",
        originalBackup: { productTitle: "Saved original product name", productDescription: "<p>Original saved description.</p>", seoTitle: "Original SEO title", handle: "original-rug" },
        generatedPayload: JSON.stringify({ productTitle: summary.title, productDescription: `<h2>${summary.title}</h2><p>A personal accent for your room.</p><h3>Design details</h3><ul><li>Printed artwork</li><li>Soft surface</li></ul><script>window.fixtureUnsafe=true</script>`,
          productSeoTitle: `${summary.title} | Studio`, productSeoDescription: "Choose a record-inspired rug for your music room. Personalize the printed artwork with your name.",
          productHandle: summary.handle, shopifySyncStatus: summary.syncStatus, shopifyAdminUrl: "https://admin.shopify.com/store/preview/products/1",
          images: summary.id === "fixture-4" ? [] : Array.from({ length: 9 }, (_, index) => ({ sourceUrl: "https://fixture.invalid/rug.svg", alt: `Record rug view ${index + 1}`, webp: { filename: `rug-${index + 1}.webp`, url: "https://fixture.invalid/rug.svg" } })) }) } });
    }
    if (url.pathname.endsWith("/review-list") || url.pathname.endsWith("/catalog")) return respond(emptyPage);
    return respond({ items: [], reviews: [], entries: [], total: 0, nextOffset: null, counts: {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mkdir(artifacts, { recursive: true });
  await page.goto(`${origin}/seo-review?storeId=preview-store`, { waitUntil: "networkidle" });
  const reader = page.getByRole("region", { name: "Khung đọc kết quả SEO", exact: true });
  await reader.getByRole("heading", { name: titles[0], level: 3, exact: true }).waitFor();
  await reader.getByRole("tabpanel").getByRole("heading", { name: "Mô tả sản phẩm", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Boolean(window.fixtureUnsafe)), false);
  assert.equal(await reader.getByRole("button", { name: "Sync Shopify", exact: true }).count(), 0);
  await page.screenshot({ path: `${artifacts}/split-light.png`, fullPage: true });
  await reader.getByRole("tab", { name: "Nguồn & kết quả", exact: true }).click();
  await reader.getByText("Saved original product name", { exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/comparison-light.png`, fullPage: true });
  await reader.getByRole("tab", { name: /^Ảnh & Alt/ }).click();
  await reader.getByRole("button", { name: "Phóng to ảnh #1", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await reader.getByRole("tab", { name: "AEO", exact: true }).click();
  await reader.getByText("Chưa có FAQ trong bản ghi này.").waitFor();
  await reader.getByRole("tab", { name: "AEO", exact: true }).press("ArrowRight");
  assert.equal(await reader.getByRole("tab", { name: "Nguồn & kết quả", exact: true }).getAttribute("aria-selected"), "true");
  await reader.getByRole("button", { name: "Sản phẩm kế tiếp", exact: true }).click();
  await reader.getByRole("heading", { name: titles[1], level: 3, exact: true }).waitFor();
  await reader.getByRole("tab", { name: "Nội dung SEO", exact: true }).waitFor();
  await page.getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  const widths = [];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    widths.push({ width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    await page.screenshot({ path: `${artifacts}/split-dark-${width}.png`, fullPage: true });
  }
  assert.ok(widths.every(entry => !entry.overflow));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await reader.getByRole("button", { name: "Xem chi tiết sản phẩm", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Chi tiết sản phẩm SEO", exact: true });
  await drawer.waitFor();
  await drawer.getByRole("heading", { name: "Mô tả sản phẩm", exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/drawer-dark.png` });
  await page.keyboard.press("Escape");
  const mode = page.getByRole("combobox", { name: "Kiểu hiển thị Review", exact: true });
  await mode.selectOption("table");
  await page.getByRole("table").waitFor();
  await page.screenshot({ path: `${artifacts}/table-dark.png`, fullPage: true });
  await page.getByRole("button", { name: "Đã sync (2)", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
  assert.ok(queries.some(query => query.includes("workspace=synced")));
  await page.getByRole("button", { name: "Cần kiểm tra (1)", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  assert.ok(queries.some(query => query.includes("stage=failed")));
  const search = page.getByRole("textbox", { name: "Tìm sản phẩm Review", exact: true });
  await search.fill("no-match-fixture");
  await page.getByRole("heading", { name: "Chưa có kết quả phù hợp", exact: true }).waitFor();
  await search.fill("");
  await page.getByRole("table").waitFor();
  listShouldFail = true;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Không tải được danh sách" }).waitFor();
  listShouldFail = false;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="alert"]')].some(node => node.textContent.includes("Không tải được danh sách")));
  await page.getByRole("combobox", { name: "Store đang xem", exact: true }).selectOption("empty-store");
  await page.getByRole("heading", { name: "Chưa có kết quả phù hợp", exact: true }).waitFor();
  assert.equal(await page.getByRole("table").count(), 0);
  assert.equal(blockedWrites, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtureProducts: summaries.length, desktopWidths: widths, businessWrites: blockedWrites, runtimeErrors: errors.length, artifacts }));
} finally { await browser.close(); }
