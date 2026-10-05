import assert from "node:assert/strict";
import test from "node:test";

import { diffSeoSnapshots } from "../seo-versioning";
import type { SeoContentSnapshotInput } from "../seo-versioning";

function snapshot(overrides: Partial<SeoContentSnapshotInput> = {}): SeoContentSnapshotInput {
  return { contentHash: "a".repeat(64), title: "Title", descriptionHtml: "", seoTitle: null, seoDescription: "Meta",
    images: [], aeoMetafields: {}, handle: "handle", onlineStoreUrl: null, observedCanonicalUrl: null,
    shopifyStatus: "ACTIVE", vendor: null, productType: null, tags: [], ...overrides };
}

test("snapshot diff is deterministic and preserves missing, null and empty values", () => {
  const before = snapshot({ aeoMetafields: { "z.value": null, "b.value": "" }, images: [
    { mediaGid: "gid://shopify/MediaImage/2", imageUrl: "two", alt: null, width: 2, height: 2 },
  ] });
  const after = snapshot({ seoTitle: "", aeoMetafields: { "a.value": "answer", "b.value": null }, images: [
    { mediaGid: "gid://shopify/MediaImage/1", imageUrl: "one", alt: "", width: 1, height: 1 },
  ] });
  const diff = diffSeoSnapshots(before, after);
  assert.deepEqual(diff.fields.map(field => field.field), ["seoTitle", "aeoMetafields.a.value", "aeoMetafields.b.value", "aeoMetafields.z.value"]);
  assert.deepEqual(diff.fields[1]?.before, { presence: "MISSING" });
  assert.deepEqual(diff.fields[2]?.before, { presence: "VALUE", value: "" });
  assert.deepEqual(diff.fields[2]?.after, { presence: "VALUE", value: null });
  assert.deepEqual(diff.images.map(image => [image.mediaGid, image.change]), [
    ["gid://shopify/MediaImage/1", "ADDED"], ["gid://shopify/MediaImage/2", "REMOVED"],
  ]);
  assert.deepEqual(diffSeoSnapshots(before, after), diff);
});
