import assert from "node:assert/strict";
import test from "node:test";

import {
  getPinterestPodClient,
  mockCandidates,
  mockDeliverables,
  mockPinterestPodClient,
  packageDeliverablesForSeo,
  realPinterestPodClient,
  RealPinterestPodClient,
} from "..";
import { AppError } from "../../../shared/errors";
import type { JobDetailResponse } from "../types";

test("Mock client returns expected initial auth status and handles launchLogin", async () => {
  const status = await mockPinterestPodClient.getAuthStatus();
  assert.equal(status.ok, true);
  assert.equal(typeof status.logged_in, "boolean");

  const loginRes = await mockPinterestPodClient.launchLogin(600);
  assert.equal(loginRes.ok, true);

  const updatedStatus = await mockPinterestPodClient.getAuthStatus();
  assert.equal(updatedStatus.logged_in, true);
});

test("Mock client workflow: createJob -> poll ready_for_review -> produce -> completed", async () => {
  const created = await mockPinterestPodClient.createJob({
    niche: "vintage distressed rug",
    product: "rug",
    workflow_stage: "crawl_and_review",
    candidatePoolSize: 15,
  });

  assert.equal(created.ok, true);
  assert.ok(created.jobId.startsWith("job_"));
  assert.equal(created.status, "running");

  // First poll: still running
  const poll1 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll1.status, "running");
  assert.equal(poll1.stepper?.current_step, 1);

  // Second poll: transitions to ready_for_review with candidates
  const poll2 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll2.status, "ready_for_review");
  assert.equal(poll2.stepper?.current_step, 2);
  assert.equal(poll2.stepper?.percent, 40);
  assert.ok((poll2.candidates?.length ?? 0) > 0);

  // Send produce command
  const produceRes = await mockPinterestPodClient.produce({
    jobId: created.jobId,
    selected_candidates: ["cand_pin_101", "cand_pin_102"],
  });
  assert.equal(produceRes.ok, true);
  assert.equal(produceRes.status, "producing");

  // Third poll: producing
  const poll3 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll3.status, "producing");
  assert.equal(poll3.stepper?.current_step, 3);

  // Fourth poll: completed with deliverables
  const poll4 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll4.status, "completed");
  assert.equal(poll4.stepper?.current_step, 4);
  assert.equal(poll4.stepper?.percent, 100);
  assert.ok(poll4.deliverables !== undefined);
  assert.equal(poll4.deliverables?.print_cmyk_images.length, 2);
  assert.equal(poll4.deliverables?.lifestyle_mockups.length, 4);
  assert.equal(poll4.deliverables?.comparison_rows.length, 2);
});

test("Mock client handles cancelJob", async () => {
  const created = await mockPinterestPodClient.createJob({
    niche: "cancel test rug",
    product: "rug",
  });

  const cancelRes = await mockPinterestPodClient.cancelJob(created.jobId);
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.status, "cancelled");

  const detail = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(detail.status, "cancelled");
});

test("packageDeliverablesForSeo formats deliverables conforming to CONTRACT_PINTEREST_POD_TO_SEO.md", () => {
  const fakeJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_20260921_test",
    status: "completed",
    candidates: mockCandidates,
    deliverables: mockDeliverables,
  };

  const seoPayloadRug = packageDeliverablesForSeo(fakeJobDetail, "rug");
  assert.equal(seoPayloadRug.workflowId, "wf_20260921_test");
  assert.equal(seoPayloadRug.success, true);
  assert.equal(seoPayloadRug.productType, "rug");
  assert.equal(seoPayloadRug.totalProduced, 3);
  assert.equal(seoPayloadRug.items.length, 3);

  const item1 = seoPayloadRug.items[0];
  assert.ok(item1.designId.startsWith("design_rug_"));
  assert.equal(item1.printMaster.dpi, 300);
  assert.equal(item1.printMaster.widthPx, 4000);
  assert.equal(item1.printMaster.heightPx, 6400);
  assert.ok(item1.composedMockups.length > 0);
  assert.ok(item1.cutoutProduct.whiteBgUrl.length > 0);

  // Test Blanket dimension specs
  const seoPayloadBlanket = packageDeliverablesForSeo(fakeJobDetail, "blanket");
  assert.equal(seoPayloadBlanket.productType, "blanket");
  assert.equal(seoPayloadBlanket.items[0].printMaster.widthPx, 10000);
  assert.equal(seoPayloadBlanket.items[0].printMaster.heightPx, 11000);

  // Test RGB URL derivation conforming to CONTRACT_PINTEREST_POD_TO_SEO.md
  assert.notEqual(item1.printMaster.rgbUrl, item1.printMaster.cmykUrl);
  assert.ok(item1.printMaster.rgbUrl.includes("RGB"));

  // Edge case: Non-contiguous candidate selection mapping (e.g. candidate 105 only selected)
  const cand105 = mockCandidates.find((c) => c.id === "cand_pin_105");
  assert.ok(cand105 !== undefined);

  const selectiveJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_selective",
    status: "completed",
    candidates: mockCandidates, // all 6 candidates
    deliverables: {
      print_cmyk_images: [
        { filename: "design_01_cmyk_300dpi.jpg", url: "/api/assets/wf_selective/design_01_cmyk_300dpi.jpg" },
      ],
      lifestyle_mockups: [
        {
          filename: "mock_01.jpg",
          url: "/api/assets/wf_selective/mock_01.jpg",
          scene_type: "living_room",
          scene_description: "Retro living room",
        },
      ],
      product_cutouts_white: [
        { filename: "design_01_white.jpg", url: "/api/assets/wf_selective/design_01_white.jpg" },
      ],
      comparison_rows: [
        {
          index: 1,
          product_label: `Mẫu #1: ${cand105.title}`,
          source_url: cand105.image_url,
          final_print_url: "/api/assets/wf_selective/design_01_cmyk_300dpi.jpg",
          ai_background_urls: ["/api/assets/wf_selective/mock_01.jpg"],
        },
      ],
    },
  };

  const selectivePayload = packageDeliverablesForSeo(selectiveJobDetail, "rug");
  assert.equal(selectivePayload.totalProduced, 1);
  assert.equal(selectivePayload.items.length, 1);
  // Must correctly map to cand_pin_105, NOT cand_pin_101!
  assert.equal(selectivePayload.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(selectivePayload.items[0].originalPinTitle, cand105.title);
  assert.equal(selectivePayload.items[0].composedMockups.length, 1);
  assert.equal(selectivePayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_selective/mock_01.jpg");

  // Edge case: Empty deliverables
  const emptyJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_empty",
    status: "completed",
  };
  const emptyPayload = packageDeliverablesForSeo(emptyJobDetail, "custom");
  assert.equal(emptyPayload.totalProduced, 0);
  assert.equal(emptyPayload.items.length, 0);
  assert.equal(emptyPayload.productType, "custom");
});

test("Mock client dynamically adapts deliverables to selected candidate IDs and blanket product type", async () => {
  const blanketJob = await mockPinterestPodClient.createJob({
    niche: "retro 70s blanket",
    product: "blanket",
  });

  // Poll until ready for review
  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const ready = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(ready.status, "ready_for_review");

  // Select only 1 specific candidate: cand_pin_105
  const produceRes = await mockPinterestPodClient.produce({
    jobId: blanketJob.jobId,
    selected_candidates: ["cand_pin_105"],
  });
  assert.equal(produceRes.ok, true);

  // Poll through producing to completed
  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const completed = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(completed.status, "completed");

  // Check that completed deliverables reflect exactly 1 candidate and blanket specs
  assert.equal(completed.summaryMetrics?.cmyk_count, 1);
  assert.equal(completed.summaryMetrics?.rgb_4k_count, 1);
  assert.equal(completed.summaryMetrics?.lifestyle_mockup_count, 2);
  assert.equal(completed.deliverables?.print_cmyk_images.length, 1);
  assert.equal(completed.deliverables?.comparison_rows.length, 1);

  // Verify blanket dimension in generated deliverables
  const cmykSvgUrl = decodeURIComponent(completed.deliverables?.print_cmyk_images[0].url ?? "");
  assert.match(cmykSvgUrl, /10000x11000px/);

  // Package for SEO and verify blanket specs
  const seoPayload = packageDeliverablesForSeo(completed, "blanket");
  assert.equal(seoPayload.totalProduced, 1);
  assert.equal(seoPayload.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(seoPayload.items[0].printMaster.widthPx, 10000);
  assert.equal(seoPayload.items[0].printMaster.heightPx, 11000);
});

test("getPinterestPodClient selects appropriate client based on environment", () => {
  const mockClient = getPinterestPodClient("mock");
  assert.equal(mockClient, mockPinterestPodClient);

  const devClient = getPinterestPodClient("development");
  assert.ok(devClient instanceof RealPinterestPodClient);

  const prodClient = getPinterestPodClient("production");
  assert.ok(prodClient instanceof RealPinterestPodClient);
});

test("RealPinterestPodClient wraps fetch errors into AppError with appropriate codes", async () => {
  const originalFetch = globalThis.fetch;

  try {
    // Simulate HTTP 500 error
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Pinterest session expired" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(
      async () => {
        await realPinterestPodClient.getAuthStatus();
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "PINTEREST_AUTH_CHECK_FAILED");
        assert.match(err.message, /Pinterest session expired/);
        return true;
      },
    );

    // Simulate Network Failure
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:8765");
    };

    await assert.rejects(
      async () => {
        await realPinterestPodClient.createJob({
          niche: "test",
          product: "rug",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "PINTEREST_JOB_CREATION_FAILED");
        assert.match(err.message, /ECONNREFUSED/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
