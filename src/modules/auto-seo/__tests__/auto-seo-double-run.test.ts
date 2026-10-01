import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MockAutoSeoClient } from "../mocks/runner";
import { AutoSeoPage } from "../ui/AutoSeoPage";
import type { AutoSeoToolbarProps } from "../ui/components/AutoSeoToolbar";

const product = {
  id: "gid://shopify/Product/8484620664917",
  title: "Original product",
  handle: "original-product",
  status: "ACTIVE",
  images: [{ url: "https://example.com/product.jpg", altText: "Original" }],
  tags: ["product"],
} as const;

function makeRun(backendRunsSeo: boolean): {
  run: () => Promise<void>;
  counts: { backup: number; frontend: number; handover: number };
  navigations: string[];
} {
  const counts = { backup: 0, frontend: 0, handover: 0 };
  const navigations: string[] = [];
  const client = new MockAutoSeoClient();
  const originalRun = client.runAutoSeo.bind(client);
  client.hydrateSelectedProductsFresh = async () => [product];
  client.getStoreInfo = async () => ({ storeId: "capozen", shopDomain: "capozen.myshopify.com" });
  client.runAutoSeoBackup = async request => {
    counts.backup++;
    return { workflowId: request.workflowId, backedUpCount: 1, backupIds: ["backup-1"], downstreamStatus: "SENT" };
  };
  client.runAutoSeo = async input => {
    counts.frontend++;
    return originalRun(input);
  };
  let toolbar: React.ReactElement<AutoSeoToolbarProps> | undefined;
  function Harness(): React.JSX.Element {
    const page = AutoSeoPage({
      client,
      backendRunsSeo,
      initialProducts: [product],
      initialSelectedProductIds: [product.id],
      navigate: path => { navigations.push(path); },
      onHandoverToSeo: async () => { counts.handover++; },
    }) as React.ReactElement<{ children: React.ReactNode }>;
    toolbar = React.Children.toArray(page.props.children).find(
      (child): child is React.ReactElement<AutoSeoToolbarProps> =>
        React.isValidElement(child) && typeof child.type === "function" && child.type.name === "AutoSeoToolbar",
    );
    return page;
  }
  renderToStaticMarkup(React.createElement(Harness));
  assert.ok(toolbar);
  return { run: toolbar.props.onRunAutoSeo as () => Promise<void>, counts, navigations };
}

test("real Auto SEO UI calls backend once and navigates without frontend SEO or handover", async () => {
  const flow = makeRun(true);
  await flow.run();
  assert.deepEqual(flow.counts, { backup: 1, frontend: 0, handover: 0 });
  assert.deepEqual(flow.navigations, ["/seo-review?storeId=capozen"]);
});

test("mock Auto SEO UI retains its frontend SEO and handover flow", async () => {
  const flow = makeRun(false);
  await flow.run();
  assert.deepEqual(flow.counts, { backup: 1, frontend: 1, handover: 1 });
  assert.deepEqual(flow.navigations, ["/seo-review?storeId=capozen"]);
});
