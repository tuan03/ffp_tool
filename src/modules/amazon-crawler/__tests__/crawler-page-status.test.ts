import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { amazonCrawlerMockAgentRelease, amazonCrawlerMockOutput } from "../mocks/data";
import { AmazonCrawlerPage } from "../ui/AmazonCrawlerPage";
import { clearCrawlerSession, hydrateCrawlerSessionFromJob } from "../ui/crawler-session";
import { filterConnectedCrawlerClients, getCrawlerClientPresence } from "../ui/client-presence";

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
  assert.match(markup, />Tải Agent cho Windows</);
  assert.match(markup, /https:\/\/github\.com\/tuan03\/ffp_tool\/releases\/latest/);
  clearCrawlerSession();
});

test("crawler page puts ASIN and start ahead of settings, agents and maintenance", () => {
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
  assert.ok(startPosition < markup.indexOf("Collection, loại sản phẩm"));
  assert.ok(startPosition < markup.indexOf("Crawler clients"));
  assert.ok(startPosition < markup.indexOf("Xóa toàn bộ cache"));
  assert.match(markup, /id="crawler-panel-agents"[^>]*hidden=""/);
  assert.match(markup, /id="crawler-panel-diagnostics"[^>]*hidden=""/);
  assert.match(markup, /Store nhận sản phẩm/);
  assert.match(markup, /Xử lý ảnh/);
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
