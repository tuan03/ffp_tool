import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { AppSidebar } from "../../../layouts/components/AppSidebar";
import { readSidebarCollapsed, saveSidebarCollapsed } from "../../../layouts/sidebar-preferences";

test("sidebar keeps store context on SEO and advertising destinations", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/seo-review?storeId=store-a"] },
    createElement(AppSidebar, { activeStoreId: "store-a", isCollapsed: false, onToggle: () => undefined })));
  for (const path of ["auto-seo", "gpt-seo", "seo-review", "seo-performance", "ads-intelligence"]) {
    assert.ok(html.includes(`href="/${path}?storeId=store-a"`), path);
  }
  assert.match(html, /aria-current="page"/);
  assert.match(html, /aria-label="Thu gọn menu"/);
});

test("collapsed navigation retains every destination and accessible labels", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AppSidebar, { activeStoreId: "", isCollapsed: true, onToggle: () => undefined })));
  assert.equal((html.match(/data-navigation-link/g) ?? []).length, 9);
  assert.match(html, /aria-label="Mở rộng menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /SEO Queue/);
  assert.doesNotMatch(html, /inert|aria-hidden="true"[^>]*><a/);
});

test("sidebar preferences survive reload and tolerate unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readSidebarCollapsed(storage), false);
  saveSidebarCollapsed(storage, true);
  assert.equal(readSidebarCollapsed(storage), true);
  saveSidebarCollapsed(storage, false);
  assert.equal(readSidebarCollapsed(storage), false);
  const unavailable = { getItem: (): never => { throw new Error("Unavailable"); }, setItem: (): never => { throw new Error("Unavailable"); } };
  assert.equal(readSidebarCollapsed(unavailable), false);
  assert.doesNotThrow(() => saveSidebarCollapsed(unavailable, true));
});
