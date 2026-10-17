import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CrawlerWorkspace } from "../ui/components/CrawlerWorkspace";
import type { CrawlerWorkspaceSection } from "../ui/components/CrawlerWorkspace";

function renderWorkspace(section: CrawlerWorkspaceSection): string {
  return renderToStaticMarkup(createElement(CrawlerWorkspace, {
    section,
    onSectionChange: () => {},
    summary: "Connection summary",
    crawl: createElement("input", { "aria-label": "ASIN draft", defaultValue: "B000000001" }),
    results: "Current job results",
    agents: "Agent configuration draft",
    diagnostics: "Maintenance controls",
  }));
}

test("crawler workspace defaults to a focused crawl panel with separate navigation", () => {
  const markup = renderWorkspace("crawl");
  assert.match(markup, /Cào sản phẩm/);
  assert.match(markup, /Chẩn đoán &amp; bảo trì/);
  assert.match(markup, /Hướng dẫn/);
  assert.match(markup, /id="crawler-panel-crawl"(?![^>]*hidden)/);
  assert.match(markup, /id="crawler-panel-agents"[^>]*hidden=""/);
  assert.match(markup, /id="crawler-panel-results"[^>]*hidden=""/);
  assert.match(markup, /id="crawler-panel-diagnostics"[^>]*hidden=""/);
  assert.ok(markup.indexOf("ASIN draft") < markup.indexOf("Maintenance controls"));
});

test("results have their own panel without discarding configuration", () => {
  const markup = renderWorkspace("results");
  assert.match(markup, /id="crawler-panel-results"(?![^>]*hidden)/);
  assert.match(markup, /id="crawler-panel-crawl"[^>]*hidden=""/);
  assert.match(markup, /Current job results/);
  assert.match(markup, /value="B000000001"/);
});

test("switching crawler sections keeps inactive forms mounted to preserve drafts", () => {
  const markup = renderWorkspace("agents");
  assert.match(markup, /id="crawler-panel-crawl"[^>]*hidden=""/);
  assert.match(markup, /id="crawler-panel-agents"(?![^>]*hidden)/);
  assert.match(markup, /value="B000000001"/);
  assert.match(markup, /Agent configuration draft/);
  assert.match(markup, /aria-label="Agent"[^>]*aria-pressed="true"[^>]*>[\s\S]*?<span>Agent<\/span><\/button>/);
});

test("diagnostics can be selected without discarding the crawl form", () => {
  const markup = renderWorkspace("diagnostics");
  assert.match(markup, /id="crawler-panel-diagnostics"(?![^>]*hidden)/);
  assert.match(markup, /Connection summary/);
  assert.match(markup, /ASIN draft/);
});
