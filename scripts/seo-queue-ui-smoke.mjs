import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

import { chromium } from "playwright";

const baseUrl = process.env.SEO_QUEUE_UI_URL || "http://127.0.0.1:5181";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
assert.notEqual(new URL(baseUrl).port, "3011", "Mutation scenarios require an isolated fixture preview, never the live tool");
const directory = ".cache/seo-queue-ui";
await mkdir(directory, { recursive: true });
const settings = { provider: "codex_mcp", batchSize: 5, version: 1, language: "en-US", instructions: "Use only grounded facts." };
const stages = ["analysis", "research", "keywords", "submission"];
const statuses = ["PENDING", "IN_PROGRESS", "VALIDATING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED", "REVIEW_READY", "CANCELLED"];
const titles = ["Vinyl Record Round Rug", "Woodland Bear Doormat", "Monochrome Music Rug", "Personalized Name Mat", "Minimal Line Art Rug", "Botanical Entryway Rug", "Custom Record Rug", "Archived Music Mat"];
let jobs = Array.from({ length: 55 }, (_, index) => ({
  id: `fixture-job-${String(index + 1).padStart(3, "0")}`, storeId: "capozen", source: "amazon", sourceIdentity: `amazon:B0TEST${String(index + 1).padStart(4, "0")}:style ${index + 1}`,
  inputHash: `fixture-${index}`, input: { images: index === 3 ? [] : [{ id: "front", url: "https://fixture.invalid/rug.svg" }], niche: "rugs", storeProfile: {} },
  execution: { storeId: "capozen", source: "amazon", sourceIdentity: `fixture-${index}`, providerId: index === 2 ? "gemini" : "codex_mcp", pipelineVersion: "seo-content-input-v2", originalSnapshot: {} },
  original: { title: `${titles[index] ?? `Studio Rug ${index + 1}`}`, handle: `studio-rug-${index + 1}` },
  settings: { ...settings, provider: index === 2 ? "gemini" : "codex_mcp" },
  status: statuses[index] ?? "PENDING", checkpoints: index === 1 ? { analysis: {}, research: {} } : index === 6 ? Object.fromEntries(stages.map(stage => [stage, {}])) : {},
  error: index === 5 ? "QUOTA_EXHAUSTED private-request-secret" : index === 3 ? "TOKEN_EXPIRED private-request-secret" : undefined,
  createdAt: 1_700_000_000_000, updatedAt: 1_700_001_000_000,
}));
let mode = "normal";
let mutations = [];
let listRequests = [];
let detailRequests = 0;
const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.route("https://fixture.invalid/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#fff"/><circle cx="40" cy="40" r="30" fill="#566579"/><circle cx="40" cy="40" r="10" fill="#e2c8aa"/></svg>' }));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.split("/").at(-1);
    const storeId = url.searchParams.get("storeId") || "capozen";
    const respond = json => route.fulfill({ status: 200, json });
    if (url.pathname === "/api/shopify") {
      assert.equal(request.postDataJSON().operation, "stores.list");
      return respond({ success: true, data: { stores: [{ storeId: "capozen", shopDomain: "capozen.example.myshopify.com" }, { storeId: "other", shopDomain: "other.example.myshopify.com" }] } });
    }
    if (request.method() === "POST") {
      mutations.push({ endpoint, storeId, body: request.postDataJSON() });
      if (endpoint === "retry") { jobs = jobs.map(job => job.id === request.postDataJSON().jobId ? { ...job, status: "PENDING", error: undefined } : job); return respond({}); }
      if (endpoint === "clear") return respond({ cleared: 2, archived: 0, preservedActive: 1, preservedFailed: 0 });
      if (endpoint === "settings") return respond(request.postDataJSON());
      if (endpoint === "transfer" || endpoint === "release") return respond({});
      throw new Error(`Unexpected fixture mutation: ${endpoint}`);
    }
    if (endpoint === "settings") return respond(settings);
    if (endpoint === "tokens") return respond({ tokens: [], total: 0, nextOffset: null, claimsEnabled: true });
    if (endpoint === "runs") return respond({ runs: [], total: 0, nextOffset: null });
    if (endpoint === "job") {
      detailRequests++;
      const job = jobs.find(entry => entry.id === url.searchParams.get("jobId"));
      assert.ok(job);
      return respond({ ...job, storeId });
    }
    if (endpoint === "jobs") {
      listRequests.push({ storeId, statuses: url.searchParams.get("statuses"), offset: Number(url.searchParams.get("offset")), provider: url.searchParams.get("provider") });
      if (mode === "failure") return route.fulfill({ status: 503, json: { error: { message: "Không tải được hàng đợi." } } });
      const catalog = mode === "empty" || storeId === "other" ? [] : jobs;
      const counts = Object.fromEntries(statuses.map(status => [status, catalog.filter(job => job.status === status).length]));
      const statusFilter = url.searchParams.get("statuses")?.split(",");
      const provider = url.searchParams.get("provider");
      const filtered = catalog.filter(job => (!statusFilter || statusFilter.includes(job.status)) && (!provider || job.settings.provider === provider));
      const offset = Number(url.searchParams.get("offset") || 0);
      const page = filtered.slice(offset, offset + 50).map(job => ({ ...job, original: null, execution: { ...job.execution, originalSnapshot: null }, checkpoints: {}, queueDisplay: mode === "legacy" ? undefined : { sourceTitle: job.original.title, sourceHandle: job.original.handle, checkpointStages: Object.keys(job.checkpoints) } }));
      const activeBatches = catalog.length ? [{ id: "fixture-batch-one", provider: "codex_mcp", ownerId: "codex_mcp:office-pc", leaseToken: "fixture-not-a-credential", expiresAt: 1_800_000_000_000, jobs: [{ id: "fixture-job-002", title: titles[1], status: "IN_PROGRESS" }] }] : [];
      return respond({ jobs: page, counts, activeBatches, activeBatch: activeBatches[0] ?? null, nextOffset: offset + 50 < filtered.length ? offset + 50 : null });
    }
    throw new Error(`Unexpected fixture read: ${endpoint}`);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const openQueue = async () => {
    await page.goto(`${baseUrl}/gpt-seo?storeId=capozen`);
    await page.getByRole("button", { name: "Làm mới", exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(button => button.textContent.includes("Đang tải…")));
  };
  await openQueue();
  const table = page.getByRole("table");
  await table.getByRole("button", { name: titles[0], exact: true }).waitFor();
  assert.equal(detailRequests, 0, "Catalog must not issue a detail request per row");
  assert.equal(await table.getByRole("row").count(), 51);
  assert.equal(await page.getByRole("button", { name: "Dọn Queue", exact: true }).isVisible(), false);
  assert.equal(await table.getByText("2/4 bước đã có checkpoint", { exact: true }).count(), 1);
  assert.equal(await table.getByText("Chờ AI nhận việc", { exact: true }).count(), 43);
  assert.equal(await table.getByText(/private-request-secret/).count(), 0);
  await table.getByRole("button", { name: "Sao chép job ID fixture-job-001", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "fixture-job-001");

  const query = page.getByRole("textbox", { name: "Tìm sản phẩm trong trang này", exact: true });
  await query.fill("Vinyl");
  assert.equal(await table.getByRole("row").count(), 2);
  await page.getByRole("button", { name: "Máy & phiên chạy", exact: true }).click();
  await page.getByRole("heading", { name: "Máy và quyền truy cập", exact: true }).waitFor();
  assert.equal(await table.isVisible(), false);
  await page.getByRole("navigation", { name: "Quản lý máy SEO", exact: true }).getByRole("button", { name: "Phiên chạy", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Số sản phẩm", exact: true }).fill("7");
  await page.screenshot({ path: `${directory}/worker-workspace-light.png`, fullPage: true });
  await page.getByRole("button", { name: "Hàng đợi", exact: true }).click();
  assert.equal(await query.inputValue(), "Vinyl");
  await page.getByRole("button", { name: "Máy & phiên chạy", exact: true }).click();
  assert.equal(await page.getByRole("spinbutton", { name: "Số sản phẩm", exact: true }).inputValue(), "7");
  await page.getByRole("button", { name: "Hàng đợi", exact: true }).click();
  await query.fill("");
  await page.getByRole("button", { name: /^Cần xử lý Cần bổ sung/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("#seo-queue-workspace tbody tr")].length === 3);
  assert.equal(listRequests.at(-1).statuses, "WAITING_INPUT,NEEDS_CHANGES,FAILED");
  assert.equal(listRequests.at(-1).offset, 0);
  const failedRow = table.getByRole("row").filter({ hasText: titles[5] });
  await failedRow.getByRole("button", { name: "Xem chi tiết", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("region", { name: "Vấn đề cần xử lý", exact: true }).waitFor();
  assert.ok(await drawer.getByRole("button", { name: "Thử lại", exact: true }).isVisible());
  assert.equal(await drawer.getByRole("link", { name: /Mở SEO Review/ }).count(), 0);
  assert.equal(await drawer.locator("summary").filter({ hasText: "Ảnh sản phẩm" }).evaluate(element => element.parentElement.open), false);
  await page.screenshot({ path: `${directory}/issue-detail-light.png` });
  await page.keyboard.press("Escape");
  assert.equal(await failedRow.getByRole("button", { name: "Xem chi tiết", exact: true }).evaluate(element => element === document.activeElement), true);
  await failedRow.getByRole("button", { name: "Thử lại", exact: true }).click();
  await page.getByText(/Đã đưa “Botanical Entryway Rug” vào xử lý lại/).waitFor();
  assert.deepEqual(mutations[0], { endpoint: "retry", storeId: "capozen", body: { jobId: "fixture-job-006" } });
  assert.equal(await table.getByRole("row").count(), 3);

  await page.getByRole("button", { name: "Tất cả trạng thái", exact: true }).click();
  await table.getByRole("button", { name: titles[0], exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Lọc AI xử lý", exact: true }).selectOption("gemini");
  await page.waitForFunction(() => [...document.querySelectorAll("#seo-queue-workspace tbody tr")].length === 1);
  assert.equal(listRequests.at(-1).provider, "gemini");
  await page.getByRole("combobox", { name: "Lọc AI xử lý", exact: true }).selectOption("all");
  await table.getByRole("button", { name: titles[0], exact: true }).waitFor();
  const readyRow = table.getByRole("row").filter({ hasText: titles[6] });
  await readyRow.getByRole("button", { name: "Xem chi tiết", exact: true }).click();
  await drawer.getByRole("link", { name: "Mở SEO Review của store", exact: true }).waitFor();
  assert.equal(await drawer.getByRole("link", { name: "Mở SEO Review của store", exact: true }).getAttribute("href"), "/seo-review?storeId=capozen");
  assert.equal(await drawer.getByRole("button", { name: "Thử lại", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Trang sau", exact: true }).click();
  await page.getByText("Trang 2 · hiển thị 5/5 sản phẩm trên trang", { exact: true }).waitFor();
  assert.equal(listRequests.at(-1).offset, 50);
  await page.getByRole("button", { name: "Máy & phiên chạy", exact: true }).click();
  await page.getByRole("button", { name: "Hàng đợi", exact: true }).click();
  assert.ok(await page.getByText("Trang 2 · hiển thị 5/5 sản phẩm trên trang", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Trang trước", exact: true }).click();
  await table.getByRole("button", { name: titles[0], exact: true }).waitFor();

  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: theme === "dark" ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng", exact: true }).click();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole("region", { name: "Danh sách sản phẩm SEO có thể cuộn", exact: true }).evaluate(element => { element.scrollTop = 0; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bounds = await table.boundingBox();
      assert.ok(bounds && bounds.x + bounds.width <= width);
      await page.screenshot({ path: `${directory}/queue-${theme}-${width}.png`, animations: "disabled" });
    }
  }
  const scrollRegion = page.getByRole("region", { name: "Danh sách sản phẩm SEO có thể cuộn", exact: true });
  await scrollRegion.evaluate(element => { element.scrollTop = 420; });
  const regionBounds = await scrollRegion.boundingBox();
  const headerBounds = await table.locator("thead").boundingBox();
  assert.ok(regionBounds && headerBounds && Math.abs(regionBounds.y - headerBounds.y) < 2, "Table header remains visible while scrolling rows");
  await scrollRegion.evaluate(element => { element.scrollTop = 0; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("summary").filter({ hasText: "Cấu hình & thao tác khác" }).click();
  await page.getByRole("textbox", { name: "Quy tắc nội dung", exact: true }).fill("Desktop draft remains intact.");
  await page.getByRole("button", { name: "Chuyển sang chế độ sáng", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Quy tắc nội dung", exact: true }).inputValue(), "Desktop draft remains intact.");
  page.once("dialog", dialog => { assert.match(dialog.message(), /capozen/); void dialog.dismiss(); });
  await page.getByRole("button", { name: "Dọn Queue", exact: true }).click();
  assert.equal(mutations.length, 1, "Dismissed confirmation must not clear the queue");
  await page.getByRole("combobox", { name: "Chọn cửa hàng", exact: true }).selectOption("other");
  await page.getByRole("heading", { name: "Chưa có sản phẩm trong hàng đợi", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Quy tắc nội dung", exact: true }).inputValue(), settings.instructions);
  assert.equal(listRequests.at(-1).storeId, "other");

  mode = "failure";
  await openQueue();
  await page.getByRole("heading", { name: "Chưa tải được hàng đợi", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tải lại hàng đợi", exact: true }).click();
  assert.equal(await page.getByRole("table").count(), 0);
  mode = "normal";
  await page.getByRole("button", { name: "Tải lại hàng đợi", exact: true }).click();
  await table.getByRole("button", { name: titles[0], exact: true }).waitFor();
  mode = "legacy";
  await openQueue();
  assert.equal(await table.getByText("Mở chi tiết để xem checkpoint", { exact: true }).count() > 0, true);
  assert.equal(await table.getByText("0/4", { exact: true }).count(), 0);
  assert.equal(await table.getByText(/ASIN B0TEST0001/).count() > 0, true);
  assert.deepEqual(errors, []);
  assert.equal(mutations.length, 1);
  console.log("PASS SEO Queue: six desktop/theme layouts, title and checkpoint metadata, legacy fallback, filters before pagination, workspace preservation, clipboard, error drawer/focus, safe retry, clear cancellation, store switch and load-error recovery. All APIs intercepted; no live writes.");
} finally { await browser.close(); }
