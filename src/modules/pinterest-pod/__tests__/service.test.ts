import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import {
  buildSeoDeliverables,
  cancelJob,
  cancelMockJob,
  FACTORY_PRINT_STANDARDS,
  getAssetUrl,
  getAuthStatus,
  getDiscoveryRunner,
  getMockAuthStatus,
  getPinterestAuthRunner,
  getPinterestPodClient,
  getPinterestPodRunner,
  getProductionRunner,
  handoverToSeo,
  launchLogin,
  launchMockLogin,
  mock15Candidates,
  mockCandidates,
  mockDeliverables,
  mockPinterestAuthStatus,
  mockPinterestPodClient,
  mockSeoDeliverables,
  packageDeliverablesForSeo,
  pollDiscoveryJob,
  pollProductionJob,
  realPinterestPodClient,
  RealPinterestPodClient,
  runDiscovery,
  runMockDiscovery,
  runMockProduction,
  runProduction,
  inferProductTypeFromNiche,
  startDiscoveryJob,
  startProductionJob,
  getOAuthAuthorizeUrl,
  saveOAuthToken,
  STOREFRONT_DISPLAY_STANDARD,
} from "..";
import type { JobDetailResponse, PodJobStatusResponse } from "../types";

test("buildSeoDeliverables does not publish partial assets from failed production", () => {
  assert.throws(() => buildSeoDeliverables({
    ok: true,
    jobId: "failed-production",
    status: "failed",
    deliverables: { final_png_images: [{ url: "https://example.test/master.png", filename: "master.png" }] },
  }), (error: unknown) => error instanceof AppError && error.code === "PINTEREST_POD_JOB_FAILED");
});

// ==========================================
// Tests for MockPinterestPodClient & UI Flow
// ==========================================

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
  assert.equal(poll4.deliverables?.print_cmyk_images?.length, 2);
  assert.equal(poll4.deliverables?.lifestyle_mockups?.length, 4);
  assert.equal(poll4.deliverables?.comparison_rows?.length, 2);
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
    candidates: mockCandidates,
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

  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const ready = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(ready.status, "ready_for_review");

  const produceRes = await mockPinterestPodClient.produce({
    jobId: blanketJob.jobId,
    selected_candidates: ["cand_pin_105"],
  });
  assert.equal(produceRes.ok, true);

  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const completed = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(completed.status, "completed");

  assert.equal(completed.summaryMetrics?.cmyk_count, 1);
  assert.equal(completed.summaryMetrics?.rgb_4k_count, 1);
  assert.equal(completed.summaryMetrics?.lifestyle_mockup_count, 2);
  assert.equal(completed.deliverables?.print_cmyk_images?.length, 1);
  assert.equal(completed.deliverables?.comparison_rows?.length, 1);

  const cmykSvgUrl = decodeURIComponent(completed.deliverables?.print_cmyk_images?.[0]?.url ?? "");
  assert.match(cmykSvgUrl, /10000x11000px/);

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

    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:8768");
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

// =======================================================
// Tests for Pipeline Runners, Standards & Service API
// =======================================================

test("Pinterest POD: Factory and Storefront standards are correctly defined", () => {
  assert.equal(FACTORY_PRINT_STANDARDS.rug.widthPx, 4000);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.heightPx, 6400);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.dpi, 300);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.colorMode, "CMYK");

  assert.equal(FACTORY_PRINT_STANDARDS.blanket.widthPx, 10000);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.heightPx, 11000);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.dpi, 300);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.colorMode, "CMYK");

  assert.equal(STOREFRONT_DISPLAY_STANDARD.width, 1500);
  assert.equal(STOREFRONT_DISPLAY_STANDARD.height, 1500);
  assert.equal(STOREFRONT_DISPLAY_STANDARD.fit, "contain");
  assert.equal(STOREFRONT_DISPLAY_STANDARD.background, "#ffffff");
});

test("Stage 1 Mock Discovery returns 15 scored candidates with ready_for_review status", async () => {
  let progressCalled = false;
  const result = await runMockDiscovery(
    {
      niche: "vintage distressed rug",
      product: "rug",
      candidatePoolSize: 15,
    },
    {
      onProgress: (status) => {
        progressCalled = true;
        assert.equal(status.status, "running");
      },
    },
  );

  assert.equal(progressCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_review");
  assert.equal(result.candidates.length, 15);
  assert.equal(result.stepper.current_step, 2);
  assert.equal(result.stepper.percent, 40);

  const firstCand = result.candidates[0];
  assert.equal(firstCand.id, "cand_pin_101");
  assert.equal(typeof firstCand.image_score, "number");
  assert.equal(typeof firstCand.printability_score, "number");
  assert.equal(typeof firstCand.flat_artwork_score, "number");
  assert.equal(firstCand.is_direct_printable, true);
  assert.equal(firstCand.recommended, true);
});

test("Stage 1 Mock Discovery provides independent candidate copies", async () => {
  const result1 = await runMockDiscovery({ niche: "rug", product: "rug", candidatePoolSize: 5 });
  const result2 = await runMockDiscovery({ niche: "rug", product: "rug", candidatePoolSize: 5 });

  assert.equal(result1.candidates.length, 5);
  assert.equal(result2.candidates.length, 5);
  assert.notEqual(result1.candidates, mock15Candidates);
  assert.notEqual(result1.candidates[0], result2.candidates[0]);
});

test("Stage 2 Mock Production generates completed deliverables with CMYK 300 DPI and SEO package", async () => {
  let progressCalled = false;
  const result = await runMockProduction(
    {
      jobId: "job_custom_stage2",
      selected_candidates: ["cand_pin_101", "cand_pin_102"],
      product: "rug",
    },
    {
      onProgress: (status) => {
        progressCalled = true;
        assert.equal(status.status, "running");
      },
    },
  );

  assert.equal(progressCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.stepper.percent, 100);
  assert.equal(result.summaryMetrics.cmyk_count, 2);

  const seo = result.seoDeliverables;
  assert.equal(seo.success, true);
  assert.equal(seo.productType, "rug");
  assert.equal(seo.totalProduced, 2);
  assert.equal(seo.items.length, 2);

  const item1 = seo.items[0];
  assert.equal(item1.sourceCandidateId, "cand_pin_101");
  assert.equal(item1.printMaster.dpi, 300);
  assert.equal(item1.printMaster.widthPx, 4000);
  assert.equal(item1.printMaster.heightPx, 6400);
  assert.equal(item1.printMaster.colorMode, "CMYK");
  assert.ok(item1.composedMockups.length >= 2);
  assert.ok(item1.composedMockups[0].detectedSceneType.length > 0);
  assert.ok(item1.composedMockups[0].detectedSceneDescription.length > 0);
});

test("Stage 2 Mock Production adapts dimensions for blanket product type", async () => {
  const result = await runMockProduction({
    jobId: "job_blanket_stage2",
    selected_candidates: ["cand_pin_101"],
    product: "blanket",
  });

  assert.equal(result.seoDeliverables.productType, "blanket");
  const item = result.seoDeliverables.items[0];
  assert.equal(item.printMaster.widthPx, 10000);
  assert.equal(item.printMaster.heightPx, 11000);
  assert.equal(item.printMaster.dpi, 300);
});

test("Mock auth, login, and cancel functions return expected responses", async () => {
  const auth = await getMockAuthStatus();
  assert.equal(auth.ok, true);
  assert.equal(auth.logged_in, true);

  const login = await launchMockLogin();
  assert.equal(login.ok, true);
  assert.equal(login.logged_in, true);

  const cancel = await cancelMockJob("job_123");
  assert.equal(cancel.ok, true);
});

test("Runtime environment selector correctly switches runners", () => {
  assert.equal(getDiscoveryRunner("mock"), runMockDiscovery);
  assert.equal(getDiscoveryRunner("development"), runDiscovery);
  assert.equal(getDiscoveryRunner("production"), runDiscovery);

  assert.equal(getProductionRunner("mock"), runMockProduction);
  assert.equal(getProductionRunner("development"), runProduction);
  assert.equal(getProductionRunner("production"), runProduction);

  assert.equal(getPinterestAuthRunner("mock"), getMockAuthStatus);
  assert.equal(getPinterestAuthRunner("development"), getAuthStatus);

  const mockRunner = getPinterestPodRunner("mock");
  assert.equal(mockRunner.runDiscovery, runMockDiscovery);
  assert.equal(mockRunner.runProduction, runMockProduction);

  const devRunner = getPinterestPodRunner("development");
  assert.equal(devRunner.runDiscovery, runDiscovery);
  assert.equal(devRunner.runProduction, runProduction);
});

test("Service handles job failure by throwing AppError with PINTEREST_POD_JOB_FAILED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        jobId: "job_failed_test",
        status: "failed",
        error: "Pinterest crawler encountered captcha block",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_failed_test", { intervalMs: 10, timeoutMs: 100 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_FAILED");
        assert.ok(error.message.includes("captcha"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Service handles job cancellation by throwing AppError with PINTEREST_POD_JOB_CANCELLED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        jobId: "job_cancelled_test",
        status: "cancelled",
        message: "Job was terminated by user request",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollProductionJob("job_cancelled_test", "rug", { intervalMs: 10, timeoutMs: 100 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_CANCELLED");
        assert.ok(error.message.includes("terminated by user"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Service polling handles timeout by throwing AppError with PINTEREST_POD_POLL_TIMEOUT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        jobId: "job_timeout_test",
        status: "running",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_timeout_test", { intervalMs: 20, timeoutMs: 50 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_POLL_TIMEOUT");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssetUrl constructs relative asset URLs conforming to contract", () => {
  assert.equal(getAssetUrl("job_123", "cmyk.jpg"), "/api/pinterest-pod/assets/job_123/cmyk.jpg");
  assert.equal(getAssetUrl("job 456", "room 01.jpg"), "/api/pinterest-pod/assets/job%20456/room%2001.jpg");
});

test("buildSeoDeliverables matches selected candidates accurately rather than relying on global candidate index", () => {
  const status: PodJobStatusResponse = {
    ok: true,
    jobId: "job_wf_select",
    status: "completed",
    candidates: mock15Candidates,
    deliverables: {
      comparison_rows: [
        {
          index: 1,
          product_label: "Design #1",
          source_url: "/api/pinterest-pod/assets/job_wf_select/source_105.jpg",
          cutout_url: "/api/pinterest-pod/assets/job_wf_select/design_105_cutout.png",
          cutout_white_url: "/api/pinterest-pod/assets/job_wf_select/design_105_white.jpg",
          final_print_url: "/api/pinterest-pod/assets/job_wf_select/design_105_cmyk_300dpi.jpg",
          ai_background_urls: ["/api/pinterest-pod/assets/job_wf_select/mockup_room_01_design_105.jpg"],
        },
      ],
    },
  };

  const seo = buildSeoDeliverables(status, "rug", ["cand_pin_105"]);
  assert.equal(seo.items.length, 1);
  assert.equal(seo.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(seo.items[0].originalPinTitle, mock15Candidates[4].title);
  assert.ok(seo.items[0].printMaster.localFilePath?.includes("design_105_cmyk_300dpi.jpg"));
  assert.ok(seo.items[0].cutoutProduct.localFilePath?.includes("design_105_white.jpg"));
  assert.ok(seo.items[0].composedMockups[0].localFilePath?.includes("mockup_room_01_design_105.jpg"));
});

test("Stage 2 Mock Production supports arbitrary candidate selection from candidate pool", async () => {
  const result = await runMockProduction({
    jobId: "job_custom_cand34",
    selected_candidates: ["cand_pin_103", "cand_pin_104"],
    product: "rug",
  });

  assert.equal(result.seoDeliverables.items.length, 2);
  assert.equal(result.seoDeliverables.items[0].sourceCandidateId, "cand_pin_103");
  assert.equal(result.seoDeliverables.items[1].sourceCandidateId, "cand_pin_104");
  assert.equal(result.seoDeliverables.items[0].originalPinTitle, mock15Candidates[2].title);
  assert.equal(result.seoDeliverables.items[1].originalPinTitle, mock15Candidates[3].title);
});

test("Service polling aborts immediately when signal is triggered", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ ok: true, jobId: "job_abort_test", status: "running" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_abort_test", {
          intervalMs: 100,
          timeoutMs: 5000,
          signal: controller.signal,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_ABORTED");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("startProductionJob sends product and returns production jobId", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  globalThis.fetch = async (_url, init) => {
    capturedBody = (init?.body as string) || "";
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_prod_new_99", status: "running" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await startProductionJob({
      jobId: "job_stage1_12",
      selected_candidates: ["cand_pin_101"],
      product: "blanket",
    });

    assert.equal(res.ok, true);
    assert.equal(res.jobId, "job_prod_new_99");
    assert.equal(res.status, "running");
    assert.ok(capturedBody.includes('"product":"blanket"'));
    assert.ok(capturedBody.includes('"jobId":"job_stage1_12"'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("launchLogin normalizes response with fallback status_text and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ ok: true, status: "launched", pid: 1234, message: "Trình duyệt đã mở" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const res = await launchLogin({ timeout: 300 });
    assert.equal(res.ok, true);
    assert.equal(res.status_text, "Trình duyệt đã mở");
    assert.equal(res.pid, 1234);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancelJob calls cancel endpoint and parses response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_to_cancel", status: "cancelled" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await cancelJob("job_to_cancel");
    assert.equal(res.ok, true);
    assert.equal(res.status, "cancelled");
    assert.ok(requestedUrl.includes("/api/pinterest-pod/jobs/job_to_cancel/cancel"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Mock client getStatus returns recent runs and deleteJob removes job", async () => {
  const status = await mockPinterestPodClient.getStatus();
  assert.equal(status.ok, true);
  assert.ok(Array.isArray(status.recent));
  assert.ok((status.recent?.length ?? 0) > 0);

  const created = await mockPinterestPodClient.createJob({
    niche: "nordic runner",
    product: "rug",
  });
  const updatedStatus = await mockPinterestPodClient.getStatus();
  assert.ok(updatedStatus.recent?.some((r) => r.jobId === created.jobId));

  const deleteRes = await mockPinterestPodClient.deleteJob(created.jobId);
  assert.equal(deleteRes.ok, true);

  const postDeleteStatus = await mockPinterestPodClient.getStatus();
  assert.equal(postDeleteStatus.recent?.some((r) => r.jobId === created.jobId), false);
});

test("Real client getStatus and deleteJob call respective endpoints with proper methods", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string }[] = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).includes("/status")) {
      return new Response(
        JSON.stringify({ ok: true, recent: [{ id: "job_recent_1", status: "ready_for_review" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, message: "Deleted" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const status = await realPinterestPodClient.getStatus();
    assert.equal(status.ok, true);
    assert.equal(status.recent?.[0].id, "job_recent_1");
    assert.ok(calls.some((c) => c.url.includes("/api/pinterest-pod/status") && c.method === "GET"));

    const del = await realPinterestPodClient.deleteJob("job_del_test");
    assert.equal(del.ok, true);
    assert.ok(calls.some((c) => c.url.includes("/api/pinterest-pod/jobs/job_del_test/delete") && c.method === "POST"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildSeoDeliverables filters composedMockups with approvedMockupUrls while keeping printMaster intact", () => {
  const cand = { ...mockCandidates[0], id: "cand_001", image_url: "/api/assets/cand_001.jpg" };
  const jobStatus: PodJobStatusResponse = {
    ok: true,
    jobId: "wf_approval_test",
    status: "completed",
    candidates: [cand],
    deliverables: {
      comparison_rows: [
        {
          index: 1,
          product_label: "Vintage Rug",
          source_url: "/api/assets/cand_001.jpg",
          final_print_url: "/api/assets/wf_approval_test/design_01_cmyk_300dpi.jpg",
          ai_background_urls: [
            "/api/assets/wf_approval_test/mockup_room_1.jpg",
            "/api/assets/wf_approval_test/mockup_room_2.jpg",
            "/api/assets/wf_approval_test/mockup_room_3.jpg",
          ],
        },
      ],
    },
  };

  // Case 1: No approval filter passed (defaults to all mockups)
  const allPayload = buildSeoDeliverables(jobStatus, "rug");
  assert.equal(allPayload.items.length, 1);
  assert.equal(allPayload.items[0].printMaster.dpi, 300);
  assert.equal(allPayload.items[0].composedMockups.length, 3);

  // Case 2: User only approved mockup_room_1 and mockup_room_3 (deselected mockup_room_2)
  const approvedSet = new Set([
    "/api/assets/wf_approval_test/mockup_room_1.jpg",
    "/api/assets/wf_approval_test/mockup_room_3.jpg",
  ]);
  const filteredPayload = buildSeoDeliverables(jobStatus, "rug", undefined, approvedSet);
  assert.equal(filteredPayload.items.length, 1);
  assert.equal(filteredPayload.items[0].printMaster.dpi, 300);
  assert.equal(filteredPayload.items[0].printMaster.colorMode, "CMYK");
  assert.equal(filteredPayload.items[0].composedMockups.length, 2);
  assert.equal(filteredPayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_approval_test/mockup_room_1.jpg");
  assert.equal(filteredPayload.items[0].composedMockups[1].mockupUrl, "/api/assets/wf_approval_test/mockup_room_3.jpg");

  // Case 3: Matching by filename
  const filenameApproved = new Set(["mockup_room_2.jpg"]);
  const filenameFilteredPayload = buildSeoDeliverables(jobStatus, "rug", undefined, filenameApproved);
  assert.equal(filenameFilteredPayload.items[0].composedMockups.length, 1);
  assert.equal(filenameFilteredPayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_approval_test/mockup_room_2.jpg");
});

test("Mock client handoverToSeo returns proper response with accurate counts", async () => {
  const mockPayload = {
    workflowId: "wf_test_handover",
    success: true as const,
    productType: "rug" as const,
    totalProduced: 1,
    items: [
      {
        designId: "design_rug_1",
        sourceCandidateId: "cand_1",
        productType: "rug" as const,
        originalPinTitle: "Test Pin",
        trendKeywords: ["trend"],
        printMaster: {
          cmykUrl: "/api/cmyk.jpg",
          rgbUrl: "/api/rgb.png",
          widthPx: 4000,
          heightPx: 6400,
          dpi: 300 as const,
          colorMode: "CMYK" as const,
          label: "4000 x 6400 px @ 300 DPI (CMYK)",
          badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
        },
        cutoutProduct: {
          transparentUrl: "/api/trans.png",
          whiteBgUrl: "/api/white.jpg",
        },
        composedMockups: [
          {
            referenceImageId: "ref_1",
            mockupUrl: "/api/mock_1.jpg",
            detectedSceneType: "living_room",
            detectedSceneDescription: "Living room",
          },
          {
            referenceImageId: "ref_2",
            mockupUrl: "/api/mock_2.jpg",
            detectedSceneType: "bedroom",
            detectedSceneDescription: "Bedroom",
          },
        ],
      },
    ],
  };

  const res = await mockPinterestPodClient.handoverToSeo(mockPayload);
  assert.equal(res.success, true);
  assert.equal(res.printMasterCount, 1);
  assert.equal(res.approvedMockupCount, 2);
  assert.match(res.message, /Bàn giao sang SEO thành công/);
});

test("Real client handoverToSeo and handoverToSeo function send POST to /api/pinterest-pod/handover-seo", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; body?: unknown }[] = [];

  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        success: true,
        message: "Bàn giao sang SEO thành công: 1 file in xưởng và 2 mockup AI đã duyệt.",
        receivedAt: 1726900000000,
        printMasterCount: 1,
        approvedMockupCount: 2,
        savedPath: "data/pinterest_pod/output/wf_post_test/seo_handoff_payload.json",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const payload = {
      workflowId: "wf_post_test",
      success: true as const,
      productType: "rug" as const,
      totalProduced: 1,
      items: [
        {
          designId: "design_rug_1",
          sourceCandidateId: "cand_1",
          productType: "rug" as const,
          originalPinTitle: "Test Rug",
          trendKeywords: ["rug"],
          printMaster: {
            cmykUrl: "/api/cmyk.jpg",
            rgbUrl: "/api/rgb.png",
            widthPx: 4000,
            heightPx: 6400,
            dpi: 300 as const,
            colorMode: "CMYK" as const,
            label: "4000 x 6400 px @ 300 DPI (CMYK)",
            badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
          },
          cutoutProduct: { transparentUrl: "", whiteBgUrl: "" },
          composedMockups: [
            {
              referenceImageId: "ref_1",
              mockupUrl: "/api/mock_1.jpg",
              detectedSceneType: "living_room",
              detectedSceneDescription: "Living room",
            },
          ],
        },
      ],
    };

    const res = await realPinterestPodClient.handoverToSeo(payload);
    assert.equal(res.success, true);
    assert.equal(res.printMasterCount, 1);
    assert.equal(res.approvedMockupCount, 2);
    assert.ok(
      calls.some(
        (c) =>
          c.url.includes("/api/pinterest-pod/handover-seo") &&
          c.method === "POST" &&
          (c.body as { workflowId?: string })?.workflowId === "wf_post_test",
      ),
    );

    const directRes = await handoverToSeo(payload);
    assert.equal(directRes.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ==========================================
// Tests for OAuth and Token Management API
// ==========================================

test("Mock client getOAuthAuthorizeUrl returns valid authorization URL", async () => {
  const res = await mockPinterestPodClient.getOAuthAuthorizeUrl("http://localhost:8768/api/pinterest-pod/oauth/callback");
  assert.equal(res.ok, true);
  assert.ok(res.auth_url.includes("https://www.pinterest.com/oauth/"));
  assert.ok(res.auth_url.includes("client_id=1595071"));
  assert.equal(res.redirect_uri, "http://localhost:8768/api/pinterest-pod/oauth/callback");
});

test("Mock client saveOAuthToken simulates saving access token and updates auth status", async () => {
  const res = await mockPinterestPodClient.saveOAuthToken({
    access_token: "pina_test_token_12345",
  });
  assert.equal(res.ok, true);
  assert.ok(res.message?.includes("thành công"));
  assert.equal(res.username, "mock_pinterest_user");
  assert.ok(typeof res.expires_at === "number");

  const status = await mockPinterestPodClient.getAuthStatus();
  assert.equal(status.ok, true);
  assert.equal(status.oauth_valid, true);
  assert.equal(status.token_info?.has_access_token, true);
});

test("Real client getOAuthAuthorizeUrl and saveOAuthToken call backend endpoints with proper payloads", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; body?: unknown }[] = [];

  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).includes("/oauth/authorize-url")) {
      return new Response(
        JSON.stringify({
          ok: true,
          auth_url: "https://www.pinterest.com/oauth/?client_id=1595071&mock=true",
          redirect_uri: "http://localhost:8768/api/pinterest-pod/oauth/callback",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (String(url).includes("/oauth/save-token")) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Token hợp lệ và đã lưu thành công.",
          username: "real_test_user",
          expires_at: 1726950000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  try {
    const authUrlRes = await realPinterestPodClient.getOAuthAuthorizeUrl();
    assert.equal(authUrlRes.ok, true);
    assert.ok(authUrlRes.auth_url.includes("https://www.pinterest.com/oauth/"));
    assert.ok(calls.some((c) => c.url.includes("/api/pinterest-pod/oauth/authorize-url")));

    const directAuthUrlRes = await getOAuthAuthorizeUrl();
    assert.equal(directAuthUrlRes.ok, true);

    const saveRes = await realPinterestPodClient.saveOAuthToken({
      access_token: "pina_test_live_abc123",
      refresh_token: "pinr_test_live_xyz789",
    });
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.username, "real_test_user");
    assert.ok(
      calls.some(
        (c) =>
          c.url.includes("/api/pinterest-pod/oauth/save-token") &&
          c.method === "POST" &&
          (c.body as { access_token?: string })?.access_token === "pina_test_live_abc123",
      ),
    );

    const directSaveRes = await saveOAuthToken({ access_token: "pina_direct_token" });
    assert.equal(directSaveRes.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inferProductTypeFromNiche correctly infers blanket, rug, custom, and default products", () => {
  // Blanket keywords: blanket, throw, quilt
  assert.equal(inferProductTypeFromNiche("cozy winter blanket"), "blanket");
  assert.equal(inferProductTypeFromNiche("chunky knit throw"), "blanket");
  assert.equal(inferProductTypeFromNiche("vintage patchwork quilt"), "blanket");
  assert.equal(inferProductTypeFromNiche("BLANKET FLEECE"), "blanket");

  // Rug keywords: rug, carpet, mat
  assert.equal(inferProductTypeFromNiche("vintage distressed rug"), "rug");
  assert.equal(inferProductTypeFromNiche("moroccan living room carpet"), "rug");
  assert.equal(inferProductTypeFromNiche("boho door mat"), "rug");
  assert.equal(inferProductTypeFromNiche("PERSIAN RUG"), "rug");

  // Bag keywords: bag, tote, backpack, purse, satchel
  assert.equal(inferProductTypeFromNiche("leather bag"), "bag");
  assert.equal(inferProductTypeFromNiche("canvas tote bag"), "bag");
  assert.equal(inferProductTypeFromNiche("vintage backpack"), "bag");

  // Custom keyword: custom
  assert.equal(inferProductTypeFromNiche("custom wooden wall art"), "custom");
  assert.equal(inferProductTypeFromNiche("CUSTOM PRINT DESIGN"), "custom");

  // Other niches default to custom
  assert.equal(inferProductTypeFromNiche("table wood aesthetic"), "custom");
  assert.equal(inferProductTypeFromNiche("abstract wall art"), "custom");
  assert.equal(inferProductTypeFromNiche(""), "custom");
});

test("RealPinterestPodClient.createJob infers product and forwards crawlCount parameters", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(init.body.toString()) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_test_123", status: "running" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    // 1. When product is omitted, infer blanket from niche
    const res1 = await realPinterestPodClient.createJob({
      niche: "retro 70s accent blanket",
      candidatePoolSize: 55,
    });
    assert.equal(res1.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.product, "blanket");
    assert.equal(calls[0].body.candidatePoolSize, 55);
    assert.equal(calls[0].body.task5_max_downloads, 55);
    assert.equal(calls[0].body.top_images, 55);

    // 2. When product is omitted and niche is rug
    const res2 = await realPinterestPodClient.createJob({
      niche: "boho runner rug",
      candidatePoolSize: 30,
    });
    assert.equal(res2.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.product, "rug");
    assert.equal(calls[1].body.candidatePoolSize, 30);
    assert.equal(calls[1].body.task5_max_downloads, 30);
    assert.equal(calls[1].body.top_images, 30);

    // 3. startDiscoveryJob function also infers product and passes poolSize
    const res3 = await startDiscoveryJob({
      niche: "warm cozy throw",
      candidatePoolSize: 60,
    });
    assert.equal(res3.ok, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.product, "blanket");
    assert.equal(calls[2].body.candidatePoolSize, 60);
    assert.equal(calls[2].body.task5_max_downloads, 60);
    assert.equal(calls[2].body.top_images, 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RealPinterestPodClient.produce infers product and forwards ai_background_variants", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(init.body.toString()) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_prod_test", status: "producing" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await realPinterestPodClient.produce({
      jobId: "job_stage1_abc",
      selected_candidates: ["cand_pin_101"],
      niche: "cozy fleece blanket",
      ai_background_variants: 3,
    });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.product, "blanket");
    assert.equal(calls[0].body.ai_background_variants, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MockPinterestPodClient.createJob infers product type when omitted", async () => {
  const blanketJob = await mockPinterestPodClient.createJob({
    niche: "luxury plush blanket",
  });
  assert.equal(blanketJob.ok, true);
  const blanketDetail = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(blanketDetail.product, "blanket");

  const rugJob = await mockPinterestPodClient.createJob({
    niche: "persian traditional rug",
  });
  assert.equal(rugJob.ok, true);
  const rugDetail = await mockPinterestPodClient.getJobDetail(rugJob.jobId);
  assert.equal(rugDetail.product, "rug");
});

test("MockPinterestPodClient.produce with reference images determines mockup output count directly", async () => {
  const job = await mockPinterestPodClient.createJob({
    niche: "nordic style wool rug",
  });

  // Advance to ready_for_review
  await mockPinterestPodClient.getJobDetail(job.jobId);
  await mockPinterestPodClient.getJobDetail(job.jobId);

  // Produce with 3 reference room images
  const refImages = [
    { id: "ref_1", url: "data:image/png;base64,room1", name: "Living Room 1" },
    { id: "ref_2", url: "data:image/png;base64,room2", name: "Living Room 2" },
    { id: "ref_3", url: "data:image/png;base64,room3", name: "Living Room 3" },
  ];

  await mockPinterestPodClient.produce({
    jobId: job.jobId,
    selected_candidates: ["cand_pin_101"],
    referenceImages: refImages,
  });

  // Advance producing -> completed
  await mockPinterestPodClient.getJobDetail(job.jobId);
  const completed = await mockPinterestPodClient.getJobDetail(job.jobId);

  assert.equal(completed.status, "completed");
  // 1 candidate * 3 reference images = 3 mockups
  assert.equal(completed.deliverables?.lifestyle_mockups?.length, 3);
  assert.equal(completed.deliverables?.comparison_rows?.[0]?.ai_background_urls?.length, 3);
});

test("MockPinterestPodClient.discoverTrends returns theme clusters and rejected keywords", async () => {
  const result = await mockPinterestPodClient.discoverTrends({
    niche: "vintage distressed rug",
    product: "rug",
    trend_type: "growing",
    region: "US",
  });

  assert.equal(result.ok, true);
  assert.equal(result.niche, "vintage distressed rug");
  assert.ok(result.clusters.length >= 3);
  assert.ok(result.rejected_keywords.length > 0);

  const cluster1 = result.clusters[0];
  assert.ok(cluster1.cluster_id.length > 0);
  assert.ok(cluster1.cluster_name || cluster1.theme_name);
  assert.ok((cluster1.fused_queries ?? cluster1.sample_queries ?? []).length > 0);

  const rej1 = result.rejected_keywords[0];
  assert.ok(rej1.keyword.length > 0);
  assert.ok(rej1.reject_reason && rej1.reject_reason.length > 0);
});

test("RealPinterestPodClient.discoverTrends posts to backend and parses result", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(init.body.toString()) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({
        ok: true,
        niche: "gothic celestial tarot",
        product: "bag",
        trend_type: "seasonal",
        region: "US",
        clusters: [
          {
            cluster_id: "cluster_gothic",
            theme_name: "Gothic Celestial",
            fused_queries: ["gothic celestial seamless pattern vector"],
            recommended: true,
          },
        ],
        rejected_keywords: [
          {
            keyword: "pumpkin soup recipe",
            reject_reason: "Công thức món ăn (Food / recipes)",
          },
        ],
        total_keywords: 15,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await realPinterestPodClient.discoverTrends({
      niche: "gothic celestial tarot",
      product: "bag",
      trend_type: "seasonal",
      region: "US",
    });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/pinterest-pod/trends/discover"));
    assert.equal(calls[0].body.niche, "gothic celestial tarot");
    assert.equal(calls[0].body.product, "bag");
    assert.equal(calls[0].body.trend_type, "seasonal");
    assert.equal(calls[0].body.region, "US");
    assert.equal(res.clusters[0].cluster_id, "cluster_gothic");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MockPinterestPodClient.rescueCandidate restores candidate to breakthrough concept", async () => {
  const job = await mockPinterestPodClient.createJob({
    niche: "retro groovy pumpkin",
  });

  const detail = await mockPinterestPodClient.getJobDetail(job.jobId);
  const targetRej = detail.rejected_candidates?.[0] ?? detail.rejectedCandidates?.[0];
  const targetId = targetRej?.id || "mock_rej_101";

  const rescueRes = await mockPinterestPodClient.rescueCandidate(job.jobId, targetId);
  assert.equal(rescueRes.ok, true);
  assert.equal(rescueRes.candidate.candidate_category, "breakthrough_concept");
  assert.equal(rescueRes.candidate.is_breakthrough_concept, true);
  assert.equal(rescueRes.candidate.is_rejected, false);
  assert.equal(rescueRes.candidate.recommended, true);
});

test("RealPinterestPodClient.rescueCandidate posts to rescue endpoint and returns rescued candidate", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(init.body.toString()) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({
        ok: true,
        candidate: {
          id: "cand_rescue_999",
          title: "Rescued Lifestyle Concept",
          image_url: "https://example.com/rescued.jpg",
          candidate_category: "breakthrough_concept",
          is_breakthrough_concept: true,
          is_rejected: false,
          recommended: true,
          printability_score: 85,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await realPinterestPodClient.rescueCandidate("job_test_123", "cand_rescue_999");
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/pinterest-pod/jobs/job_test_123/rescue"));
    assert.equal(res.candidate.candidate_category, "breakthrough_concept");
    assert.equal(res.candidate.is_breakthrough_concept, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RealPinterestPodClient.createJob serializes discovery clusters and custom queries", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(init.body.toString()) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_created_with_clusters", status: "running" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await realPinterestPodClient.createJob({
      niche: "cottagecore botanical floral",
      product: "blanket",
      trend_type: "growing",
      interest: "home_decor",
      region: "US",
      selected_clusters: ["cluster_botanical"],
      custom_queries: ["cottagecore botanical floral seamless pattern vector"],
    });

    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.product, "blanket");
    assert.equal(calls[0].body.trend_type, "growing");
    assert.equal(calls[0].body.interest, "home_decor");
    assert.equal(calls[0].body.region, "US");
    assert.deepEqual(calls[0].body.selected_clusters, ["cluster_botanical"]);
    assert.deepEqual(calls[0].body.custom_queries, ["cottagecore botanical floral seamless pattern vector"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MockPinterestPodClient.createJob preserves selected_clusters in getJobDetail", async () => {
  const customCluster = {
    cluster_id: "cluster_test_custom",
    theme_name: "Custom Ghost Aesthetic",
    fused_queries: ["custom ghost pattern vector"],
  };

  const job = await mockPinterestPodClient.createJob({
    niche: "custom ghost",
    selected_clusters: [customCluster],
  });

  const detail = await mockPinterestPodClient.getJobDetail(job.jobId);
  assert.equal(detail.ok, true);
  assert.ok(detail.clusters && detail.clusters.length > 0);
  assert.equal(detail.clusters[0].cluster_id, "cluster_test_custom");
  assert.equal(detail.clusters[0].theme_name, "Custom Ghost Aesthetic");
});

