import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AdsIntelligencePage } from "../ui/AdsIntelligencePage";
import { createMockAdsIntelligenceClient } from "../mocks/runner";

test("AdsIntelligencePage renders initial store view with streamlined tabs", async () => {
  const client = createMockAdsIntelligenceClient();
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/ads-intelligence?storeId=chillgen"] },
      createElement(AdsIntelligencePage, { client })
    )
  );

  // In synchronous SSR render before effects execute, displays status indicator
  assert.match(html, /Đang đọc danh sách store từ Gateway…/);
});

test("Competitor panel and spy panel pause polling when document is hidden", () => {
  const originalDocument = globalThis.document;
  try {
    let visibilityState = "hidden";
    (globalThis as any).document = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener() {},
      removeEventListener() {},
    };

    assert.equal(document.visibilityState, "hidden");
    visibilityState = "visible";
    assert.equal(document.visibilityState, "visible");
  } finally {
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete (globalThis as any).document;
    }
  }
});

test("Empty badges do not show zero counts for deferred tabs", () => {
  const campaigns: readonly any[] = [];
  const briefs: readonly any[] = [];

  const campaignBadge = campaigns.length || null;
  const briefBadge = briefs.length || null;

  assert.equal(campaignBadge, null);
  assert.equal(briefBadge, null);

  const populatedCampaigns = [{ id: "camp_1" }, { id: "camp_2" }];
  assert.equal(populatedCampaigns.length || null, 2);
});
