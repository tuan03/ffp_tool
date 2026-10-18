import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { amazonCrawlerMockAgentRelease, amazonCrawlerMockOutput } from "../mocks/data";
import { AmazonCrawlerPage } from "../ui/AmazonCrawlerPage";
import { clearCrawlerSession, getCrawlerSessionState, hydrateCrawlerSessionFromJob, updateCrawlerSession } from "../ui/crawler-session";
import { filterConnectedCrawlerClients, getCrawlerClientPresence } from "../ui/client-presence";

test("crawler input does not suggest switching stores based on previous product titles", () => {
  clearCrawlerSession();
  const sourceProduct = amazonCrawlerMockOutput.products[0];
  assert.ok(sourceProduct);
  updateCrawlerSession({
    urlText: "B0GGSBXL7L",
    settings: { ...amazonCrawlerMockOutput.settings, storeId: "jeminise", productType: "Blanket" },
    output: { ...amazonCrawlerMockOutput, products: [{ ...sourceProduct, title: "Floral Area Rug" }] },
  });
  try {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(AmazonCrawlerPage, {
        clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
        loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
        loadAmazonCrawlerClients: async () => [],
        runAmazonCrawler: async () => amazonCrawlerMockOutput,
      }),
    ));
    assert.doesNotMatch(markup, /Link cào có vẻ là|Chuyển sang capozen/);
    assert.match(markup, /B0GGSBXL7L/);
    assert.equal(getCrawlerSessionState().settings.storeId, "jeminise");
  } finally {
    clearCrawlerSession();
  }
});

test("crawler agent list excludes disconnected agents", () => {
  const clients = [
    { id: "online", isConnected: true, status: "online" },
    { id: "busy", isConnected: true, status: "busy" },
    { id: "offline", isConnected: false, status: "offline" },
    { id: "inconsistent", isConnected: true, status: "offline" },
  ] as const;

  assert.deepEqual(filterConnectedCrawlerClients(clients).map((client) => client.id), ["online", "busy"]);
});

test("stale coordinator snapshots show unknown presence instead of a false online or stopped state", () => {
  assert.deepEqual(getCrawlerClientPresence(true, "online", true), { label: "chưa xác minh", tone: "unknown" });
  assert.deepEqual(getCrawlerClientPresence(false, "offline", false), { label: "offline", tone: "offline" });
});

test("crawler page stops at SEO Queue handoff after restoring a downstream job", () => {
  clearCrawlerSession();
  const sourceProduct = amazonCrawlerMockOutput.products[0];
  assert.ok(sourceProduct);
  const product = {
    ...sourceProduct,
    pipeline: {
      status: "waiting_review" as const,
      normalization: { status: "completed" as const, assetsNormalized: 1 },
      seo: { status: "completed" as const },
      shopify: { attempts: 0 },
    },
  };

  hydrateCrawlerSessionFromJob({
    jobId: "job-awaiting-review",
    status: "review_pending",
    products: [product],
    output: { ...amazonCrawlerMockOutput, products: [product] },
  });

  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  assert.match(markup, /Đã bàn giao SEO Queue/);
  assert.match(markup, /Mở SEO Queue/);
  assert.doesNotMatch(markup, /Chờ kiểm duyệt SEO|Shopify:|Proxy Shopify|SEO fallback/);
  assert.match(markup, /Xử lý ảnh/);
  assert.match(markup, /Tiếp tục tự động sau SEO theo profile đã chọn/);
  assert.equal((markup.match(/aria-label="Trạng thái phiên cào"/g) ?? []).length, 1);
  assert.match(markup, /Đã bàn giao 1\/1 sản phẩm sang SEO Queue/);
  assert.match(markup, />Tải Agent cho Windows</);
  assert.match(markup, /https:\/\/github\.com\/tuan03\/ffp_tool\/releases\/latest/);
  clearCrawlerSession();
});

test("crawler page keeps settings open with one start action ahead of agents and maintenance", () => {
  clearCrawlerSession();
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  const inputPosition = markup.indexOf("Amazon URLs hoặc ASIN");
  const startPosition = markup.indexOf("Bắt đầu cào (0 link)");
  assert.ok(inputPosition > 0);
  assert.ok(inputPosition < startPosition);
  assert.ok(startPosition > markup.indexOf("Collection, loại sản phẩm"));
  assert.match(markup, /<section aria-label="Collection, loại sản phẩm &amp; định giá"/);
  assert.doesNotMatch(markup, /<summary[^>]*>Collection, loại sản phẩm/);
  assert.match(markup, /aria-label="Trạng thái phiên cào"/);
  assert.ok(startPosition < markup.indexOf("Crawler clients"));
  assert.ok(startPosition < markup.indexOf("Xóa toàn bộ cache"));
  assert.match(markup, /id="crawler-panel-agents"[^>]*hidden=""/);
  assert.match(markup, /id="crawler-panel-diagnostics"[^>]*hidden=""/);
  assert.match(markup, /Store nhận sản phẩm/);
  assert.match(markup, /Cấu hình cào theo store/);
  assert.match(markup, /role="group" aria-label="Store và Vendor" class="[^"]*md:grid-cols-2/);
  assert.match(markup, /aria-label="Cấu hình cào theo store"/);
  assert.match(markup, /Đang tải cấu hình store/);
  assert.match(markup, /class="[^"]*min-h-32[^"]*"[^>]*placeholder=/);
  assert.equal((markup.match(/>Bắt đầu cào \(0 link\)<\/button>/g) ?? []).length, 1);
  assert.ok(markup.lastIndexOf("Bắt đầu cào (0 link)") > markup.indexOf("Collection, loại sản phẩm"));
  clearCrawlerSession();
});

test("start buttons show durable eighteen-product handoff even without loaded cards", () => {
  clearCrawlerSession();
  hydrateCrawlerSessionFromJob({ jobId: "job-empty-cards", status: "review_pending", products: [],
    output: { ...amazonCrawlerMockOutput, jobId: "job-empty-cards", products: [],
      seoQueueHandoff: { totalProducts: 18, handedOver: 18, pending: 0, notHandedOver: 0 },
    },
  });
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [], runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));
  assert.equal((markup.match(/aria-label="Trạng thái phiên cào"/g) ?? []).length, 1);
  assert.match(markup, /Đã bàn giao 18\/18 sản phẩm sang SEO Queue/);
  clearCrawlerSession();
});

test("restored product details are in a closed dialog rather than expanding the crawl page", () => {
  clearCrawlerSession();
  hydrateCrawlerSessionFromJob({
    jobId: "job-restored-details",
    status: "completed",
    products: amazonCrawlerMockOutput.products,
    output: amazonCrawlerMockOutput,
  });
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  assert.match(markup, /<dialog[^>]*aria-labelledby=/);
  assert.doesNotMatch(markup, /<dialog[^>]*\sopen(?:=|\s|>)/);
  assert.match(markup, /Chi tiết sản phẩm đã cào/);
  assert.match(markup, /Nhấn để xem ảnh và chi tiết/);
  assert.match(markup, /Tiếp tục tự động sau SEO theo profile đã chọn/);
  clearCrawlerSession();
});

test("collection and pricing settings always stay open with one store selector", () => {
  clearCrawlerSession();
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  assert.match(markup, /<section aria-label="Collection, loại sản phẩm &amp; định giá"/);
  assert.match(markup, /Kiểm tra ASIN trên Shopify/);
  assert.match(markup, /<aside aria-label="Kiểm tra ASIN trên Shopify"/);
  assert.doesNotMatch(markup, /aria-haspopup="dialog"[^>]*>[^<]*Kiểm tra ASIN trên Shopify/);
  for (const dialog of markup.matchAll(/<dialog\b[^>]*>[\s\S]*?<\/dialog>/g)) {
    assert.doesNotMatch(dialog[0], /Kiểm tra ASIN trên Shopify/);
  }
  assert.match(markup, /aria-label="Lọc ASIN trên Shopify"/);
  assert.equal((markup.match(/<select[^>]*>[\s\S]*?<\/select>/g) ?? []).filter((select) => select.includes('value="capozen"')).length, 1);
  assert.match(markup, /Tìm collection/);
  assert.match(markup, /aria-label="Sửa store"/);
  assert.match(markup, /Giá cộng thêm/);
  assert.match(markup, /Giá gạch ngang/);
  clearCrawlerSession();
});
