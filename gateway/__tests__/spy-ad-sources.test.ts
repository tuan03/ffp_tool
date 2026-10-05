import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { captureSpyAdSources, preserveSpyAdSources } from "../ads-intelligence/spy-ad-sources";
import { normalizeSnapshotAd } from "../ads-intelligence/competitor-client";
import { competitorResearchSchema } from "../ads-intelligence/competitor-research";

test("Spy preserves source media signatures when the model rewrites URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spy-source-"));
  try {
    const source = normalizeSnapshotAd({ ad_archive_id: "234", page_id: "123", snapshot: { link_url: "https://other.example/blanket", images: [{ original_image_url: "https://cdn.example/blanket.jpg?signature=original" }] } }, "123");
    await captureSpyAdSources(directory, { structuredContent: { ads: [source] } });
    const report = competitorResearchSchema.parse({ storeId: "one", shopDomain: "one.myshopify.com", storeDomain: "one.example", observedAt: "2026-01-01T00:00:00Z", scope: { products: ["blanket"], excluded: [], market: "US", currency: "USD" }, selected: [{ name: "Other", domain: "other.example", productGroup: "blanket", score: 70, scoreBreakdown: { product: 40, customizationModel: 20, audience: 10, price: 0, themes: 0 }, confidence: "high", evidence: [{ url: "https://other.example/blanket", note: "Blanket" }], adStatus: "Verified" }], verifiedAds: [{ brandDomain: "other.example", qualificationReason: "Image reviewed", productEvidenceUrl: "https://other.example/blanket", ad: { ...source, mediaUrls: ["https://cdn.example/blanket.jpg?signature=changed"], inspectionLevel: "IMAGE_REVIEWED" } }], adCollection: [{ brandDomain: "other.example", pageIds: ["123"], identityEvidence: [], status: "verified_ads", retrievedCount: 1, matchedCount: 1, note: "Fixture" }], limitations: [], websiteDerivedHypotheses: [] });
    const restored = await preserveSpyAdSources(directory, report);
    assert.deepEqual(restored.verifiedAds?.[0]?.ad.mediaUrls, source.mediaUrls);
    assert.equal(restored.verifiedAds?.[0]?.ad.inspectionLevel, "IMAGE_REVIEWED");
    assert.notDeepEqual(report.verifiedAds?.[0]?.ad.mediaUrls, source.mediaUrls);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
